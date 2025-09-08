const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database.js');
const xlsx = require('xlsx');

const app = express();
const port = process.env.PORT || 3000;

async function initializeServer() {
    // IMPORTANT: This secret should be stored securely in an environment variable, not hardcoded.
    // Using a static secret is crucial because generating a new one on each server start
    // will invalidate all existing user tokens.
    const JWT_SECRET = process.env.JWT_SECRET || 'a-secure-and-static-secret-for-development-is-required';

    function getNewId(collectionName) {
        const collection = db.get(collectionName).value();
        return collection.length > 0 ? Math.max(...collection.map(item => item.id)) + 1 : 1;
    }

    // --- Ensure Admin User Exists on Startup ---
    let adminUser = db.get('users').find({ role: 'admin' }).value();

    if (!adminUser) {
        console.log('Admin user not found, creating one...');
        const adminPassword = await bcrypt.hash('admin', 10);
        const newAdmin = { id: 1, name: 'Admin User', username: 'admin', email: 'admin@cognizant.com', password: adminPassword, role: 'admin' };
        db.get('users').push(newAdmin).write();
        console.log('Admin user created.');
    } else {
        console.log('Admin user is present.');
    }

    // --- Ensure rto_status object exists in DB ---
    if (!db.has('rto_status').value()) {
        console.log('Initializing rto_status in database...');
        db.set('rto_status', null).write();
    }

    // --- Data Migration for rto_status to rto_status_history ---
    if (db.has('rto_status').value() && db.get('rto_status').value() !== null) {
        console.log('Migrating rto_status to rto_status_history...');
        const oldStatus = db.get('rto_status').value();
        const history = db.has('rto_status_history').value() ? db.get('rto_status_history').value() : [];
        history.unshift(oldStatus); // Add to the beginning
        db.set('rto_status_history', history).write();
        db.unset('rto_status').write();
        console.log('Migration complete.');
    } else if (!db.has('rto_status_history').value()) {
        console.log('Initializing rto_status_history in database...');
        db.set('rto_status_history', []).write();
    }
    // --- Data Migration for missing dlOwner ---
    const dlsWithoutOwner = db.get('users').filter(u => u.role === 'dl' && !u.dlOwner).value();
    if (dlsWithoutOwner.length > 0) {
        console.log(`Found ${dlsWithoutOwner.length} DL account(s) with a missing owner. Updating...`);
        db.get('users')
          .filter(u => u.role === 'dl' && !u.dlOwner)
          .each(user => {
              user.dlOwner = 'Pre-existing'; // Assign a default value for old records
          })
          .write();
        console.log('DL owner migration complete.');
    }

    // --- Middleware ---
    app.use(express.json()); // To parse JSON request bodies
    app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

    // --- Authentication Middleware ---
    function authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (token == null) return res.sendStatus(401); // if there isn't any token

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403); // if the token is no longer valid
            req.user = user;
            next();
        });
    }

    function authorizeAdmin(req, res, next) {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        next();
    }

    function authorizeManager(req, res, next) {
        if (req.user.role !== 'manager') {
            return res.status(403).json({ message: 'Manager access required' });
        }
        next();
    }

    // --- API Endpoints ---

    // Login Endpoint
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password are required.' });
           }

            const user = db.get('users').find({ email: email }).value();

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }
         
           // The user object from lowdb will always have a password if it exists.

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const payload = { id: user.id, name: user.name, email: user.email, role: user.role, managerName: user.managerName };
            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

            res.json({ token });
        } catch (error) {
            console.error('Error during login process:', error);
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });

    // User Registration Endpoint (Admin only)
    app.post('/api/users/register', authenticateToken, authorizeAdmin, async (req, res) => {
        try {
            const { username, name, email, password, role } = req.body;
            if (!username || !name || !email || !password || !role) {
                return res.status(400).json({ message: 'Emp ID, Emp Name, email, password, and role are required.' });
            }

            const existingUserByUsername = db.get('users').find({ username: username }).value();
            if (existingUserByUsername) {
                return res.status(409).json({ message: 'User with this username already exists.' }); // 409 Conflict
            }
            const existingUserByEmail = db.get('users').find({ email: email }).value();
            if (existingUserByEmail) {
                return res.status(409).json({ message: 'User with this email already exists.' }); // 409 Conflict
            }

            const newHashedPassword = await bcrypt.hash(password, 10);
            let managerName = null;
            if (role === 'manager') {
                // When a manager is created, set their managerName to their own name by default.
                managerName = name;
            }

            // Generate a new ID.
            const newId = getNewId('users');

            const newUser = { id: newId, username, name, email, password: newHashedPassword, role, managerName };

            db.get('users').push(newUser).write();

            res.status(201).json({ message: `User '${username}' registered successfully as a ${role}.` });
        } catch (error) {
            console.error('Error during user registration:', error);
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });

    // DL Creation Endpoint (Manager only)
    app.post('/api/dl/register', authenticateToken, authorizeManager, async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password are required.' });
            }

            const existingUserByEmail = db.get('users').find({ email: email }).value();
            if (existingUserByEmail) {
                return res.status(409).json({ message: 'A user with this email already exists.' });
            }

            const newHashedPassword = await bcrypt.hash(password, 10);
            
            // Generate a new ID.
            const newId = getNewId('users');
            const username = email.split('@')[0];

            // Capture the name of the manager creating the DL
            const dlOwner = req.user.name;
            const newUser = { id: newId, username: username, name: username, email: email, password: newHashedPassword, role: 'dl', managerName: null, dlOwner: dlOwner };

            db.get('users').push(newUser).write();
            res.status(201).json({ message: `DL account '${email}' created successfully.` });
        } catch (error) {
            console.error('Error during DL registration:', error);
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });

    // --- User Management Endpoints (Admin Only) ---

    // GET all users (for admin view)
    app.get('/api/users', authenticateToken, authorizeAdmin, (req, res) => {
        const allUsers = db.get('users').value();
        res.json(allUsers.map(({ password, ...user }) => user)); // Return users without password
    });

    // DELETE a user
    app.delete('/api/users/:id', authenticateToken, authorizeAdmin, (req, res) => {
        const userId = parseInt(req.params.id, 10);

        if (req.user.id === userId) {
            return res.status(400).json({ message: 'Admin cannot delete their own account.' });
        }

        const result = db.get('users').remove({ id: userId }).write();

        if (result.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(200).json({ message: 'User deleted successfully.' });
    });

    // --- Self-Service Password Change ---
    app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body;
            const userId = req.user.id; // Get user ID from authenticated token

            if (!currentPassword || !newPassword) {
                return res.status(400).json({ message: 'Current and new passwords are required.' });
            }

            if (newPassword.length < 6) { // Basic password policy
                return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
            }

            const user = db.get('users').find({ id: userId }).value();

            if (!user) {
                // This should not happen if authenticateToken works correctly
                return res.status(404).json({ message: 'User not found.' });
            }

            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.status(401).json({ message: 'Incorrect current password.' });
            }

            const newHashedPassword = await bcrypt.hash(newPassword, 10);
            db.get('users').find({ id: userId }).assign({ password: newHashedPassword }).write();

            res.json({ message: 'Password updated successfully.' });
        } catch (error) {
            console.error('Error changing password:', error);
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });
    // --- RTO Status Upload and Retrieval Endpoints ---

    /**
     * @route   POST /api/rto-status/upload
     * @desc    Upload RTO status counts
     * @access  Private (RTOITVALIDATION@cognizant.com only)
     */
    app.post('/api/rto-status/upload', authenticateToken, (req, res) => {
        // 1. Authorize: Check if the user is the specific DL account
        if (req.user.email !== 'RTOITVALIDATION@cognizant.com') {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to upload RTO status.' });
        }

        const statusData = req.body;

        // 2. Validate: Ensure the complex data structure is correct
        if (!statusData || !statusData.summary_counts || !statusData.aging_matrix || !statusData.aging_matrix.statuses || !statusData.aging_matrix.totals) {
            return res.status(400).json({ message: 'Invalid data structure. "summary_counts" and "aging_matrix" are required.' });
        }

        // Validate summary_counts
        const summaryKeys = ['completed', 'pendingVlan', 'pendingMyAccess', 'pendingMyAccessEdp', 'pendingMyAccessPm', 'pendingUat', 'vlanInProgress', 'businessUatTroubleshooting', 'firewallInProgress', 'grandTotal'];
        for (const key of summaryKeys) {
            const value = statusData.summary_counts[key];
            if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
                return res.status(400).json({ message: `Invalid value for summary count '${key}'. Must be a non-negative integer.` });
            }
        }

        // Validate aging_matrix
        const matrixCategories = ['firewallInProgress', 'pendingUat', 'pendingMyAccess', 'pendingMyAccessEdp', 'pendingMyAccessPm', 'pendingVlan', 'vlanInProgress', 'businessUatTroubleshooting'];
        const timeBuckets = ['within2Weeks', 'c3weeks', 'c4weeks', 'c1_5to2months', 'c2to2_5months', 'grandTotal'];

        for (const category of matrixCategories) {
            if (!statusData.aging_matrix.statuses[category]) {
                return res.status(400).json({ message: `Missing data for matrix category: ${category}` });
            }
            for (const bucket of timeBuckets) {
                const value = statusData.aging_matrix.statuses[category][bucket];
                if (typeof value !== 'number' || value < 0 || !Number.isInteger(value)) {
                    return res.status(400).json({ message: `Invalid value for matrix field ${category}.${bucket}. Must be a non-negative integer.` });
                }
            }
        }

        // 3. Process & Store: Save the data to the database
        const history = db.get('rto_status_history').value() || [];
        const newId = history.length > 0 ? Math.max(...history.map(h => h.id || 0)) + 1 : 1;

        const statusToSave = {
            id: newId,
            ...statusData,
            uploadedBy: req.user.email, // Track who uploaded the status
            uploadedAt: new Date().toISOString() // Track when it was uploaded
        };

        history.push(statusToSave);
        db.set('rto_status_history', history).write();
        console.log('RTO Status Updated by', req.user.email);

        // 4. Respond: Send a success message back to the client
        res.status(200).json({ message: 'RTO status counts uploaded successfully.' });
    });

    /**
     * @route   GET /api/rto-status/latest
     * @desc    Get the latest uploaded RTO status
     * @access  Private (Dashboard users: Admin, Manager, Engineer, DL)
     */
    app.get('/api/rto-status/latest', authenticateToken, (req, res) => {
        const allowedRoles = ['admin', 'manager', 'engineer', 'dl'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to view this data.' });
        }

        const history = db.get('rto_status_history').value();

        if (!history || history.length === 0) {
            return res.status(404).json({ message: 'No RTO status has been uploaded yet.' });
        }
        // The latest is the last one added
        res.status(200).json(history[history.length - 1]);
    });

    /**
     * @route   GET /api/rto-status/history
     * @desc    Get the history of all RTO status uploads
     * @access  Private (Manager, Engineer, DL)
     */
    app.get('/api/rto-status/history', authenticateToken, (req, res) => {
        const allowedRoles = ['manager'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Forbidden: You are not authorized to view this data.' });
        }

        const history = db.get('rto_status_history').value() || [];
        // Return sorted by most recent first
        res.status(200).json(history.slice().reverse());
    });

    /**
     * @route   GET /api/rto-status/export
     * @desc    Export RTO status history to Excel
     * @access  Private (Manager only)
     */
    app.get('/api/rto-status/export', authenticateToken, authorizeManager, (req, res) => {
        try {
            const { startDate, endDate, id } = req.query;
            const history = db.get('rto_status_history').value() || [];
            let filteredHistory = [];

            if (id) {
                // Exporting a single entry by ID
                const entry = history.find(e => e.id == id);
                if (entry) {
                    filteredHistory.push(entry);
                }
            } else if (startDate && endDate) {
                // Exporting by date range
                filteredHistory = history.filter(entry => {
                    const uploadDate = new Date(entry.uploadedAt);
                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    end.setUTCHours(23, 59, 59, 999); // Set to the very end of the selected day in UTC.
                    return uploadDate >= start && uploadDate <= end;
                });
            } else {
                return res.status(400).json({ message: 'An ID or a start/end date range is required.' });
            }

            if (filteredHistory.length === 0) {
                return res.status(404).json({ message: 'No history found for the selected criteria.' });
            }

            const workbook = xlsx.utils.book_new();

            filteredHistory.forEach(entry => {
                const sheetData = [];
                const { summary_counts, aging_matrix, uploadedAt } = entry;

                sheetData.push([`RTO Status Report - ${new Date(uploadedAt).toLocaleString()}`]);
                sheetData.push([]);

                sheetData.push(['Pending Actions Summary']);
                sheetData.push(['Status', 'Count', 'Percentage']);
                const pendingBusinessCount = (summary_counts.pendingVlan || 0) + (summary_counts.pendingMyAccess || 0) + (summary_counts.pendingMyAccessEdp || 0) + (summary_counts.pendingMyAccessPm || 0) + (summary_counts.pendingUat || 0);
                const pendingItCount = (summary_counts.vlanInProgress || 0) + (summary_counts.firewallInProgress || 0) + (summary_counts.businessUatTroubleshooting || 0);
                const totalPendingActions = pendingBusinessCount + pendingItCount;
                const businessPercentage = totalPendingActions > 0 ? `${((pendingBusinessCount / totalPendingActions) * 100).toFixed(2)}%` : '0.00%';
                const itPercentage = totalPendingActions > 0 ? `${((pendingItCount / totalPendingActions) * 100).toFixed(2)}%` : '0.00%';
                sheetData.push(['Pending actions from Business', pendingBusinessCount, businessPercentage]);
                sheetData.push(['Pending action from IT', pendingItCount, itPercentage]);
                sheetData.push([]);

                sheetData.push(['Overall Status Counts']);
                sheetData.push(['Status', 'Count']);
                const summaryLabels = {
                    completed: 'Completed',
                    pendingVlan: 'Pending with Project POC(VLAN Request Yet to raise)',
                    pendingMyAccess: 'Pending with Project POC(MYAccess Yet to raise)',
                    pendingUat: 'Pending with Business for UAT',
                    pendingMyAccessEdp: 'Pending with POC(MYAccess-EDP pending)',
                    pendingMyAccessPm: 'Pending with POC(MYAccess-PM pending)',
                    vlanInProgress: 'VLAN request in progress',
                    businessUatTroubleshooting: 'Business UAT Testing Troubleshooting in progress',
                    firewallInProgress: 'Firewall request in progress',
                    grandTotal: 'Grand Total'
                };
                const displayOrder = [
                    'completed',
                    'pendingVlan',
                    'pendingMyAccess',
                    'pendingUat',
                    'pendingMyAccessEdp',
                    'pendingMyAccessPm',
                    'vlanInProgress',
                    'businessUatTroubleshooting',
                    'firewallInProgress',
                    'grandTotal'
                ];
                displayOrder.forEach(key => {
                    if (Object.hasOwnProperty.call(summary_counts, key)) {
                        sheetData.push([summaryLabels[key], summary_counts[key]]);
                    }
                });
                sheetData.push([]);

                sheetData.push(['Aged Request Details']);
                sheetData.push(['Row Labels', 'With in 2 Weeks', '3 Weeks', '4 Weeks', '1.5 - 2 Month', '2 - 2.5 Month', 'Grand Total']);
                const statusRowLabels = {
                    firewallInProgress: 'Firewall request in progress',
                    pendingUat: 'Pending with Business for UAT',
                    pendingMyAccess: 'Pending with Project POC(MYAccess Yet to raise)',
                    pendingMyAccessEdp: 'Pending with POC(MYAccess-EDP pending)',
                    pendingMyAccessPm: 'Pending with POC(MYAccess-PM pending)',
                    pendingVlan: 'Pending with Project POC(VLAN Request Yet to raise)',
                    vlanInProgress: 'VLAN request in progress',
                    businessUatTroubleshooting: 'Business UAT Testing Troubleshooting in progress'
                };
                const agingMatrixDisplayOrder = [
                    'pendingVlan',
                    'pendingMyAccess',
                    'pendingUat',
                    'pendingMyAccessEdp',
                    'pendingMyAccessPm',
                    'vlanInProgress',
                    'businessUatTroubleshooting',
                    'firewallInProgress'
                ];
                agingMatrixDisplayOrder.forEach(categoryKey => {
                    const rowData = aging_matrix.statuses[categoryKey];
                    if (rowData) {
                        sheetData.push([statusRowLabels[categoryKey], rowData.within2Weeks || 0, rowData.c3weeks || 0, rowData.c4weeks || 0, rowData.c1_5to2months || 0, rowData.c2to2_5months || 0, rowData.grandTotal || 0]);
                    }
                });
                const totalsData = aging_matrix.totals;
                sheetData.push(['Grand Total', totalsData.within2Weeks || 0, totalsData.c3weeks || 0, totalsData.c4weeks || 0, totalsData.c1_5to2months || 0, totalsData.c2to2_5months || 0, totalsData.grandTotal || 0]);

                const worksheet = xlsx.utils.aoa_to_sheet(sheetData);
                // Make sheet names unique by using the full ISO string, as sheet names must be unique.
                // Max sheet name length is 31 chars.
                const sheetName = new Date(uploadedAt).toISOString().replace(/[:.]/g, '-').slice(0, 31);
                xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
            });

            const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Disposition', 'attachment; filename="RTO_Status_Report.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);
        } catch (error) {
            console.error('Error exporting RTO history:', error);
            res.status(500).json({ message: 'An internal server error occurred during export.' });
        }
    });

    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

initializeServer().catch(err => {
    console.error("Failed to initialize server:", err);
    process.exit(1);
});