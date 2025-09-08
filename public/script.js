document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    // Note: Some elements will be null depending on whether this is the login or dashboard page.
    let pendingActionsChart = null;
    let rtoHistoryData = []; // To store fetched history
    let rtoHistoryCurrentPage = 1;
    const rtoHistoryItemsPerPage = 5; // Number of history items per page
    let uploadConfirmationModal = null;
    let closeModalButton = null;
    let cancelModalButton = null;
    let confirmModalButton = null;
    let confirmCompletedSpan = null;
    let confirmPendingSpan = null;
    let resetConfirmationModal = null;
    let resetModalCloseButton = null;
    let resetModalCancelButton = null;
    let resetModalConfirmButton = null;

    let userListData = []; // To store the fetched user list
    let userListSortColumn = 'name'; // Default sort column
    let userListSortDirection = 'asc'; // Default sort direction

    // --- App State ---
    let token = localStorage.getItem('token');

    // --- Global Loader Helper Functions ---
    const showGlobalLoader = () => {
        const loader = document.getElementById('global-loader-overlay');
        if (loader) loader.classList.add('is-active');
    };

    const hideGlobalLoader = () => {
        const loader = document.getElementById('global-loader-overlay');
        if (loader) loader.classList.remove('is-active');
    };
    // --- Helper Functions ---
    const parseJwt = (token) => {
        try {
            return JSON.parse(atob(token.split('.')[1]));
        } catch (e) {
            return null;
        }
    };

    const renderSummaryTable = (summaryCounts) => {
        const summaryTableBody = document.getElementById('rto-summary-display-body');
        if (!summaryTableBody) return;

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
            'completed', 'pendingVlan', 'pendingMyAccess', 'pendingUat',
            'pendingMyAccessEdp', 'pendingMyAccessPm', 'vlanInProgress',
            'businessUatTroubleshooting', 'firewallInProgress', 'grandTotal'
        ];

        let summaryContent = '';
        displayOrder.forEach(key => {
            let rowClass = '';
            if (key === 'completed') rowClass = 'status-completed';
            else if (['pendingVlan', 'pendingMyAccess', 'pendingMyAccessEdp', 'pendingMyAccessPm', 'pendingUat'].includes(key)) rowClass = 'status-pending-business';
            else if (['vlanInProgress', 'businessUatTroubleshooting', 'firewallInProgress'].includes(key)) rowClass = 'status-pending-it';
            else if (key === 'grandTotal') rowClass = 'status-grand-total';

            const value = summaryCounts[key] || 0;
            const label = summaryLabels[key] || key;
            if (key === 'grandTotal') {
                summaryContent += `<tr class="${rowClass}"><td><strong>${label}</strong></td><td><strong>${value}</strong></td></tr>`;
            } else {
                summaryContent += `<tr class="${rowClass}"><td>${label}</td><td>${value}</td></tr>`;
            }
        });
        summaryTableBody.innerHTML = summaryContent;
    };

    const renderPendingActions = (summaryCounts) => {
        const pendingActionsTableBody = document.getElementById('rto-pending-actions-summary-body');
        const chartCanvas = document.getElementById('pending-actions-chart');
        if (!pendingActionsTableBody || !chartCanvas) return;

        const pendingBusinessCount = (summaryCounts.pendingVlan || 0) +
                                     (summaryCounts.pendingMyAccess || 0) +
                                     (summaryCounts.pendingMyAccessEdp || 0) +
                                     (summaryCounts.pendingMyAccessPm || 0) +
                                     (summaryCounts.pendingUat || 0);

        const pendingItCount = (summaryCounts.vlanInProgress || 0) +
                               (summaryCounts.firewallInProgress || 0) +
                               (summaryCounts.businessUatTroubleshooting || 0);

        const totalPendingActions = pendingBusinessCount + pendingItCount;
        const businessPercentage = totalPendingActions > 0 ? ((pendingBusinessCount / totalPendingActions) * 100).toFixed(2) : '0.00';
        const itPercentage = totalPendingActions > 0 ? ((pendingItCount / totalPendingActions) * 100).toFixed(2) : '0.00';

        pendingActionsTableBody.innerHTML = `
            <tr>
                <td>Pending actions from Business</td>
                <td>${pendingBusinessCount}</td>
                <td>${businessPercentage}%</td>
            </tr>
            <tr>
                <td>Pending action from IT</td>
                <td>${pendingItCount}</td>
                <td>${itPercentage}%</td>
            </tr>`;

        // Render Chart
        const chartTotalPending = document.getElementById('chart-total-pending');
        if (chartTotalPending) {
            chartTotalPending.textContent = totalPendingActions;
        }

        const chartData = {
            labels: ['Pending from Business', 'Pending from IT'],
            datasets: [{
                label: 'Pending Actions',
                data: [pendingBusinessCount, pendingItCount],
                backgroundColor: ['rgba(255, 159, 64, 0.7)', 'rgba(54, 162, 235, 0.7)'],
                borderColor: ['rgba(255, 159, 64, 1)', 'rgba(54, 162, 235, 1)'],
                borderWidth: 1
            }]
        };

        if (pendingActionsChart) pendingActionsChart.destroy();
        pendingActionsChart = new Chart(chartCanvas, {
            type: 'doughnut',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%', // Make room for the center text
                plugins: {
                    legend: {
                        display: false // Hide legend to keep it clean
                    }
                }
            }
        });
    };

    const renderAgingMatrix = (agingMatrix) => {
        const displayTableBody = document.getElementById('rto-status-display-body');
        const displayTableFoot = document.getElementById('rto-status-display-foot');
        if (!displayTableBody || !displayTableFoot || !agingMatrix.statuses || !agingMatrix.totals) return;

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
            'pendingVlan', 'pendingMyAccess', 'pendingUat', 'pendingMyAccessEdp',
            'pendingMyAccessPm', 'vlanInProgress', 'businessUatTroubleshooting', 'firewallInProgress'
        ];

        const timeBucketKeys = ['within2Weeks', 'c3weeks', 'c4weeks', 'c1_5to2months', 'c2to2_5months', 'grandTotal'];

        let matrixBodyContent = '';
        agingMatrixDisplayOrder.forEach(categoryKey => {
            const rowData = agingMatrix.statuses[categoryKey] || {};
            matrixBodyContent += `<tr><td>${statusRowLabels[categoryKey]}</td>`;
            timeBucketKeys.forEach(timeKey => {
                const value = rowData[timeKey] || 0;
                let cellClass = 'aging-cell';
                if (timeKey !== 'grandTotal' && value > 0) {
                    if (value <= 5) cellClass += ' aging-low';
                    else if (value <= 10) cellClass += ' aging-medium';
                    else cellClass += ' aging-high';
                }
                if (timeKey === 'grandTotal') cellClass += ' total-col';
                const displayValue = value === 0 ? '-' : value;
                matrixBodyContent += `<td class="${cellClass}">${displayValue}</td>`;
            });
            matrixBodyContent += `</tr>`;
        });
        displayTableBody.innerHTML = matrixBodyContent;

        const totalsData = agingMatrix.totals;
        let matrixFootContent = `<tr class="grand-total-row"><td><strong>Grand Total</strong></td>`;
        timeBucketKeys.forEach(timeKey => {
            const value = totalsData[timeKey] || 0;
            const cellClass = value === 0 ? 'is-zero' : 'is-total';
            const displayValue = value === 0 ? '-' : value;
            matrixFootContent += `<td class="${cellClass}">${displayValue}</td>`;
        });
        matrixFootContent += `</tr>`;
        displayTableFoot.innerHTML = matrixFootContent;
    };

    // --- API Functions ---
    const fetchAndDisplayRtoStatus = async () => {
        const rtoStatusDisplayContainer = document.getElementById('rto-status-display-container');
        const rtoStatusDisplayTable = document.getElementById('rto-status-display-table');
        const rtoStatusDisplayMeta = document.getElementById('rto-status-display-meta');
        const rtoStatusDisplayStatus = document.getElementById('rto-status-display-status');
        
        // Get all the table bodies and skeleton bodies
        const pendingActionsBody = document.getElementById('rto-pending-actions-summary-body');
        const pendingActionsSkeleton = document.getElementById('rto-pending-actions-summary-skeleton');
        const summaryBody = document.getElementById('rto-summary-display-body');
        const summarySkeleton = document.getElementById('rto-summary-display-skeleton');
        const agingBody = document.getElementById('rto-status-display-body');
        const agingSkeleton = document.getElementById('rto-status-display-skeleton');
        const agingFoot = document.getElementById('rto-status-display-foot');
    
        showGlobalLoader();
        // This function is now safer. The entire logic is wrapped in a try/finally
        // to guarantee that spinners and skeletons are hidden, even if an
        // unexpected error occurs during element selection or initial setup.
        try {
            // Check for essential elements to prevent script errors
            if (!rtoStatusDisplayContainer || !pendingActionsBody || !summaryBody || !agingBody) {
                console.error('One or more dashboard components are missing from the DOM.');
                if (rtoStatusDisplayStatus) {
                    rtoStatusDisplayStatus.textContent = 'Error: UI components are missing.';
                }
                return;
            }

            if (rtoStatusDisplayStatus) rtoStatusDisplayStatus.textContent = '';
            if (rtoStatusDisplayContainer) rtoStatusDisplayContainer.classList.remove('hidden');
            if (rtoStatusDisplayMeta) rtoStatusDisplayMeta.textContent = '';

            // Hide real content, show skeletons
            pendingActionsBody.classList.add('hidden');
            summaryBody.classList.add('hidden');
            agingBody.classList.add('hidden');
            agingFoot.classList.add('hidden');
            
            if (pendingActionsSkeleton) {
                pendingActionsSkeleton.classList.remove('hidden');
                pendingActionsSkeleton.innerHTML = `<tr><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr><tr><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr>`;
            }
            if (summarySkeleton) {
                summarySkeleton.classList.remove('hidden');
                summarySkeleton.innerHTML = Array(7).fill('<tr><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr>').join('');
            }
            if (agingSkeleton) {
                agingSkeleton.classList.remove('hidden');
                agingSkeleton.innerHTML = Array(6).fill('<tr><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td><td><div class="skeleton-bar"></div></td></tr>').join('');
            }
        
            const response = await fetch('/api/rto-status/latest', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
    
            if (response.status === 404) {
                rtoStatusDisplayStatus.textContent = 'No RTO status has been uploaded yet.';
                rtoStatusDisplayContainer.classList.add('hidden');
                return; // Return here to keep finally block from running over this state
            }
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch status.');
            }
    
            const data = await response.json();
            
            if (!data.summary_counts || !data.aging_matrix) {
                rtoStatusDisplayStatus.textContent = 'Received data is in an invalid format.';
                rtoStatusDisplayContainer.classList.add('hidden');
                return;
            }

            const summaryCounts = data.summary_counts;

            // To ensure accuracy, we recalculate the grand total on the client-side,
            // ignoring the potentially incorrect value from the database.
            summaryCounts.grandTotal = (summaryCounts.completed || 0) + (summaryCounts.pendingVlan || 0) +
                (summaryCounts.pendingMyAccess || 0) + (summaryCounts.pendingMyAccessEdp || 0) +
                (summaryCounts.pendingMyAccessPm || 0) + (summaryCounts.pendingUat || 0) +
                (summaryCounts.vlanInProgress || 0) + (summaryCounts.firewallInProgress || 0) +
                (summaryCounts.businessUatTroubleshooting || 0);

            // Call the new rendering functions
            renderSummaryTable(summaryCounts);
            renderPendingActions(summaryCounts);
            renderAgingMatrix(data.aging_matrix);
    
            const uploadedDate = new Date(data.uploadedAt).toLocaleString();
            rtoStatusDisplayMeta.textContent = `Last updated by ${data.uploadedBy} on ${uploadedDate}.`;
            rtoStatusDisplayContainer.classList.remove('hidden');
            rtoStatusDisplayStatus.textContent = '';
        } catch (error) {
            if (rtoStatusDisplayStatus) rtoStatusDisplayStatus.textContent = `Error: ${error.message}`;
            if (rtoStatusDisplayContainer) rtoStatusDisplayContainer.classList.add('hidden');
        } finally {
            hideGlobalLoader();
            // This block will always run, ensuring spinners and skeletons are hidden.
            
            if (pendingActionsSkeleton) pendingActionsSkeleton.classList.add('hidden');
            if (summarySkeleton) summarySkeleton.classList.add('hidden');
            if (agingSkeleton) agingSkeleton.classList.add('hidden');

            if (pendingActionsBody) pendingActionsBody.classList.remove('hidden');
            if (summaryBody) summaryBody.classList.remove('hidden');
            if (agingBody) agingBody.classList.remove('hidden');
            if (agingFoot) agingFoot.classList.remove('hidden');
        }
    };

    const showGlobalPopup = (message, isError = false) => {
        const globalPopup = document.getElementById('global-popup');
        globalPopup.textContent = message;
        globalPopup.className = 'show';
        if (isError) {
            globalPopup.classList.add('error');
        }
    
        // Hide the popup after a few seconds
        setTimeout(() => {
            globalPopup.className = '';
        }, 4000);
    };

    const showUploadModal = () => {
        if (uploadConfirmationModal) uploadConfirmationModal.classList.remove('hidden');
    };

    const hideUploadModal = () => {
        if (uploadConfirmationModal) uploadConfirmationModal.classList.add('hidden');
    };

    const showResetModal = () => {
        if (resetConfirmationModal) resetConfirmationModal.classList.remove('hidden');
    };

    const hideResetModal = () => {
        if (resetConfirmationModal) resetConfirmationModal.classList.add('hidden');
    };

    const performFormReset = () => {
        const rtoStatusUploadForm = document.getElementById('rto-status-upload-form');
        const statusP = document.getElementById('rto-status-upload-status');
        
        if (rtoStatusUploadForm) {
            rtoStatusUploadForm.reset();
        }
        if (statusP) {
            statusP.textContent = '';
            statusP.className = 'status-message';
        }
        hideResetModal();
    };

    const updateHistoryPaginationControls = () => {
        const prevButton = document.getElementById('history-prev-button');
        const nextButton = document.getElementById('history-next-button');
        const pageInfo = document.getElementById('history-page-info');
        const totalPages = Math.ceil(rtoHistoryData.length / rtoHistoryItemsPerPage);

        if (!prevButton || !nextButton || !pageInfo) return;

        pageInfo.textContent = `Page ${rtoHistoryCurrentPage} of ${totalPages || 1}`;

        prevButton.disabled = rtoHistoryCurrentPage === 1;
        nextButton.disabled = rtoHistoryCurrentPage >= totalPages;
    };

    const renderHistoryPage = (page) => {
        const historyBody = document.getElementById('rto-history-body');
        historyBody.innerHTML = '';
        rtoHistoryCurrentPage = page;

        const startIndex = (page - 1) * rtoHistoryItemsPerPage;
        const pageItems = rtoHistoryData.slice(startIndex, startIndex + rtoHistoryItemsPerPage);

        pageItems.forEach(entry => {
            const row = document.createElement('tr');
            const uploadDate = new Date(entry.uploadedAt).toLocaleString();
            row.innerHTML = `
                <td>${uploadDate}</td>
                <td>${entry.uploadedBy}</td>
                <td>
                    <button class="action-button export-single-history" data-uploaded-at="${entry.uploadedAt}" data-id="${entry.id}">Export</button>
                </td>
            `;
            historyBody.appendChild(row);
        });
        
        updateHistoryPaginationControls();
    };

    const fetchAndRenderHistory = async () => {
        const historyBody = document.getElementById('rto-history-body');
        const historyStatus = document.getElementById('rto-history-status');
        if (historyStatus) {
            historyStatus.textContent = ''; // Clear previous status messages
        }
        showGlobalLoader();
    
        try {
            const response = await fetch('/api/rto-status/history', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    logout(); // Invalid token or not authorized, force logout
                    return;
                }
                const errorData = await response.json().catch(() => ({ message: 'Failed to fetch history.' }));
                throw new Error(errorData.message);
            }
            
            rtoHistoryData = await response.json();
            historyBody.innerHTML = '';
    
            if (rtoHistoryData.length === 0) {
                historyStatus.textContent = 'No upload history found.';
                rtoHistoryCurrentPage = 1;
                updateHistoryPaginationControls();
                return;
            }
    
            historyStatus.textContent = '';
            renderHistoryPage(1); // Render the first page
        } catch (error) {
            historyStatus.textContent = `Error: ${error.message}`;
        } finally {
            hideGlobalLoader();
        }
    };

    const getFilteredAndSortedUsers = () => {
        const searchInput = document.getElementById('user-search-input');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        const filteredData = userListData.filter(user => {
            if (user.role === 'admin') return false; // Always exclude admin from display
            if (!searchTerm) return true; // Show all if search is empty

            return (
                (user.name || '').toLowerCase().includes(searchTerm) ||
                (user.email || '').toLowerCase().includes(searchTerm) ||
                (user.role || '').toLowerCase().includes(searchTerm) ||
                (user.username || '').toLowerCase().includes(searchTerm)
            );
        });

        filteredData.sort((a, b) => {
            const valA = (a[userListSortColumn] || '').toString().toLowerCase();
            const valB = (b[userListSortColumn] || '').toString().toLowerCase();

            let comparison = 0;
            if (valA > valB) {
                comparison = 1;
            } else if (valA < valB) {
                comparison = -1;
            }
            return userListSortDirection === 'asc' ? comparison : -comparison;
        });

        return filteredData;
    };

    const renderUsers = () => {
        const userListBody = document.getElementById('user-list-body');
        const userListStatus = document.getElementById('user-list-status');
        const userListTable = document.getElementById('user-list-table');

        if (!userListBody || !userListTable) return;

        const filteredData = getFilteredAndSortedUsers();

        // 3. Clear and render table
        userListBody.innerHTML = '';
        
        if (filteredData.length === 0) {
            userListStatus.textContent = 'No users found.';
        } else {
            userListStatus.textContent = '';
        }

        filteredData.forEach(user => {
            const row = document.createElement('tr');
            const idDisplay = user.role === 'dl' ? 'N/A' : user.username;
            const nameDisplay = user.role === 'dl' ? `${user.name} (DL)` : user.name;
            const dlOwnerDisplay = user.role === 'dl' ? (user.dlOwner || 'Unknown') : 'N/A';

            row.innerHTML = `
                <td>${idDisplay}</td>
                <td>${nameDisplay}</td>
                <td>${user.email}</td>
                <td>${user.role}</td>
                <td>${dlOwnerDisplay}</td>
                <td class="actions-cell">
                    <div class="actions-container">
                        <button class="action-button delete" data-id="${user.id}">Delete</button>
                    </div>
                </td>
            `;
            userListBody.appendChild(row);
        });

        // 4. Update header styles for sorting
        const headers = userListTable.querySelectorAll('th.sortable');
        headers.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sortBy === userListSortColumn) {
                th.classList.add(userListSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    };

    const fetchAndRenderUsers = async () => {
        const userListBody = document.getElementById('user-list-body');
        const userListStatus = document.getElementById('user-list-status');

    const skeletonBody = document.getElementById('user-list-skeleton');

    if (!userListBody || !userListStatus || !skeletonBody) return;

    // Show skeleton loader
    userListStatus.textContent = '';
    userListBody.classList.add('hidden');
    skeletonBody.classList.remove('hidden');

    // Generate skeleton rows
    let skeletonHTML = '';
    for (let i = 0; i < 5; i++) { // Show 5 skeleton rows
        skeletonHTML += `
            <tr>
                <td><div class="skeleton-bar"></div></td>
                <td><div class="skeleton-bar"></div></td>
                <td><div class="skeleton-bar"></div></td>
                <td><div class="skeleton-bar"></div></td>
                <td><div class="skeleton-bar"></div></td>
                <td><div class="skeleton-bar"></div></td>
            </tr>
        `;
    }
    skeletonBody.innerHTML = skeletonHTML;

        showGlobalLoader();
        try {
            const response = await fetch('/api/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.status === 401 || response.status === 403) {
                logout(); // Token is invalid or expired, force logout
                return;
            }
            if (!response.ok) throw new Error('Failed to fetch users.');
            userListData = await response.json();
            renderUsers();
        } catch (error) {
            userListStatus.textContent = `Error: ${error.message}`;
        } finally {
            hideGlobalLoader();
            // Hide skeleton loader and show the real content body
            skeletonBody.classList.add('hidden');
            userListBody.classList.remove('hidden');
        }
    };

    const escapeHTML = (str) => {
        const p = document.createElement('p');
        p.textContent = str;
        return p.innerHTML;
    };

    const showDeleteConfirmModal = (userId, userName) => {
        // Ensure no other modals are open
        hideDeleteConfirmModal();

        const modalHTML = `
            <div id="delete-confirm-modal" class="modal-overlay">
                <div class="modal-content">
                    <h3>Confirm Deletion</h3>
                    <p>Are you sure you want to delete the user <strong>${escapeHTML(userName)}</strong>? This action cannot be undone.</p>
                    <div class="modal-actions">
                        <button id="cancel-delete-button" class="action-button secondary">Cancel</button>
                        <button id="confirm-delete-button" class="action-button delete">Confirm Delete</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const confirmButton = document.getElementById('confirm-delete-button');
        const cancelButton = document.getElementById('cancel-delete-button');

        const handleDelete = async () => {
            confirmButton.textContent = 'Deleting...';
            confirmButton.disabled = true;
            cancelButton.disabled = true;
            showGlobalLoader();
            try {
                const response = await fetch(`/api/users/${userId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message);
                showGlobalPopup('User deleted successfully!');
                fetchAndRenderUsers();
                hideDeleteConfirmModal();
            } catch (error) { 
                showGlobalPopup(`Error: ${error.message}`, true);
            } finally {
                hideDeleteConfirmModal();
            }
        };

        confirmButton.addEventListener('click', handleDelete, { once: true });
        cancelButton.addEventListener('click', hideDeleteConfirmModal);
    };

    const hideDeleteConfirmModal = () => {
        const deleteConfirmModal = document.getElementById('delete-confirm-modal');
        if (deleteConfirmModal) {
            deleteConfirmModal.remove();
        }
    };
    // --- UI Update Function ---

    const handleLogin = async (event) => {
        event.preventDefault();
        const loginForm = event.target;
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const loginError = document.getElementById('login-error');
        loginError.textContent = '';
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        submitButton.disabled = true;
        submitButton.textContent = 'Logging In...';
        showGlobalLoader();

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (response.ok) {
                const data = await response.json();
                token = data.token;
                localStorage.setItem('token', token);
                window.location.href = '/dashboard.html';
            } else {
                const errorData = await response.json().catch(() => ({}));
                loginError.textContent = errorData.message || 'Invalid email or password.';
                // Re-enable button only on failure
                submitButton.disabled = false;
                submitButton.textContent = 'Login';
            }
        } catch (error) {
            loginError.textContent = 'An unexpected network error occurred.';
            submitButton.disabled = false;
            submitButton.textContent = 'Login';
        } finally {
            hideGlobalLoader();
        }
    };

    const handleRegistration = async (event) => {
        event.preventDefault();
        const registrationForm = document.getElementById('registration-form');
        const registrationStatus = document.getElementById('registration-status');

        registrationStatus.className = 'status-message';
        registrationStatus.textContent = 'Registering...';
        const username = document.getElementById('reg-emp-id').value;
        const name = document.getElementById('reg-emp-name').value;
        const emailPrefix = document.getElementById('reg-email-prefix').value;
        const password = document.getElementById('reg-password').value;
        const role = document.getElementById('reg-role').value;
        const email = `${emailPrefix}@cognizant.com`;

        // Client-side validation to ensure a role is selected
        if (!role) {
            registrationStatus.textContent = 'Please select a role for the new user.';
            registrationStatus.className = 'status-message error-message';
            return;
        }

        showGlobalLoader();
        try {
            const response = await fetch('/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ username, name, email, password, role })
            });
            const data = await response.json();
            registrationStatus.textContent = data.message;
            registrationStatus.classList.add(response.ok ? 'success' : 'error-message');

            if (response.ok) {
                const userRegistrationSection = document.getElementById('user-registration-section');
                const addUserToggleButton = document.getElementById('add-user-toggle-button');

                registrationForm.reset();
                fetchAndRenderUsers(); // Refresh user list
                showGlobalPopup('User registered successfully!');

                // Hide form and reset button text
                if (userRegistrationSection && addUserToggleButton) {
                    userRegistrationSection.classList.add('is-collapsed');
                    addUserToggleButton.textContent = 'Add New User';
                }
            }
        } catch (error) {
            registrationStatus.textContent = 'An unexpected network error occurred.';
            registrationStatus.classList.add('error-message');
        } finally {
            hideGlobalLoader();
        }
    };

    const handleDlRegistration = async (event) => {
        event.preventDefault();
        const dlCreationForm = document.getElementById('dl-creation-form');
        const dlCreationStatus = document.getElementById('dl-creation-status');

        dlCreationStatus.className = 'status-message';
        dlCreationStatus.textContent = 'Creating DL...';
        const emailPrefix = document.getElementById('dl-email-prefix').value;
        const password = document.getElementById('dl-password').value;
        const email = `${emailPrefix}@cognizant.com`;

        showGlobalLoader();
        try {
            const response = await fetch('/api/dl/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ email, password })
            });
            const data = await response.json();
            dlCreationStatus.textContent = data.message;
            dlCreationStatus.classList.add(response.ok ? 'success' : 'error-message');

            if (response.ok) {
                dlCreationForm.reset();
                showGlobalPopup('DL account created successfully!');
            }
        } catch (error) {
            dlCreationStatus.textContent = 'An unexpected network error occurred.';
            dlCreationStatus.classList.add('error-message');
        } finally {
            hideGlobalLoader();
        }
    };

    const performRtoStatusUpload = async () => {
        const rtoStatusUploadForm = document.getElementById('rto-status-upload-form');
        const rtoStatusUploadStatus = document.getElementById('rto-status-upload-status');

        hideUploadModal();

        rtoStatusUploadStatus.className = 'status-message';
        rtoStatusUploadStatus.textContent = 'Uploading...';
        showGlobalLoader();

        const formData = new FormData(rtoStatusUploadForm);

        const statusData = {
            summary_counts: {},
            aging_matrix: {
                statuses: {},
                totals: {}
            }
        };

        // --- Process Summary Counts ---
        const summaryKeys = ['completed', 'pendingVlan', 'pendingMyAccess', 'pendingMyAccessEdp', 'pendingMyAccessPm', 'pendingUat', 'vlanInProgress', 'businessUatTroubleshooting', 'firewallInProgress'];
        let calculatedGrandTotal = 0;
        for (const key of summaryKeys) {
            const value = parseInt(formData.get(`summary.${key}`), 10);
            if (isNaN(value) || value < 0) {
                rtoStatusUploadStatus.textContent = `Invalid input for summary count: ${key}. Please enter valid, non-negative numbers.`;
                rtoStatusUploadStatus.className = 'status-message error-message';
                hideGlobalLoader();
                return;
            }
            statusData.summary_counts[key] = value;
            calculatedGrandTotal += value;
        }
        statusData.summary_counts['grandTotal'] = calculatedGrandTotal;

        // --- Process Aging Matrix ---
        const matrixCategories = ['firewallInProgress', 'pendingUat', 'pendingMyAccess', 'pendingMyAccessEdp', 'pendingMyAccessPm', 'pendingVlan', 'vlanInProgress', 'businessUatTroubleshooting'];
        const timeBuckets = ['within2Weeks', 'c3weeks', 'c4weeks', 'c1_5to2months', 'c2to2_5months'];
        const matrixTotals = statusData.aging_matrix.totals;

        // Initialize matrix totals
        timeBuckets.forEach(bucket => matrixTotals[bucket] = 0);
        matrixTotals.grandTotal = 0;

        // Process matrix form data and calculate totals
        for (const category of matrixCategories) {
            statusData.aging_matrix.statuses[category] = {};
            let rowTotal = 0;
            for (const bucket of timeBuckets) {
                const value = parseInt(formData.get(`${category}.${bucket}`), 10);
                if (isNaN(value) || value < 0) {
                    rtoStatusUploadStatus.textContent = `Invalid input for matrix field: ${category}. Please enter valid, non-negative numbers.`;
                    rtoStatusUploadStatus.className = 'status-message error-message';
                    hideGlobalLoader();
                    return;
                }
                statusData.aging_matrix.statuses[category][bucket] = value;
                rowTotal += value;
                matrixTotals[bucket] += value;
            }
            statusData.aging_matrix.statuses[category].grandTotal = rowTotal;
            matrixTotals.grandTotal += rowTotal;
        }


        try {
            const response = await fetch('/api/rto-status/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(statusData)
            });

            if (!response.ok) {
                const errorResult = await response.json();
                throw new Error(errorResult.message || 'Failed to upload status.');
            }

            const result = await response.json();
            rtoStatusUploadStatus.textContent = result.message;
            rtoStatusUploadStatus.className = 'status-message success';

            const rtoStatusDisplayContainer = document.getElementById('rto-status-display-container');
            if (response.ok) {
                rtoStatusUploadForm.reset();
                showGlobalPopup('RTO status uploaded successfully!');
                // If the RTO dashboard is visible, refresh it
                if (rtoStatusDisplayContainer && !rtoStatusDisplayContainer.classList.contains('hidden')) {
                    fetchAndDisplayRtoStatus();
                }
                // Also refresh history if it's visible
                const rtoHistoryContainer = document.getElementById('rto-history-container');
                if (rtoHistoryContainer && !rtoHistoryContainer.classList.contains('hidden')) {
                    fetchAndRenderHistory();
                }
            }
        } catch (error) {
            rtoStatusUploadStatus.textContent = 'An unexpected network error occurred.';
            rtoStatusUploadStatus.className = 'status-message error-message';
        } finally {
            hideGlobalLoader();
        }
    };

    const handleRtoStatusUpload = (event) => {
        event.preventDefault();
        const uploadForm = document.getElementById('rto-status-upload-form');
        if (!uploadForm) return;

        // Calculate summary for the modal preview
        const formData = new FormData(uploadForm);
        const summaryCompleted = parseInt(formData.get('summary.completed') || 0, 10);
        
        let totalPending = 0;
        const summaryInputs = uploadForm.querySelectorAll('input[name^="summary."]');
        summaryInputs.forEach(input => {
            if (input.id !== 'summary-completed') {
                totalPending += parseInt(input.value || 0, 10);
            }
        });

        if (confirmCompletedSpan) confirmCompletedSpan.textContent = summaryCompleted;
        if (confirmPendingSpan) confirmPendingSpan.textContent = totalPending;

        showUploadModal();
    };

    const handleChangePassword = async (event) => {
        event.preventDefault();
        const form = event.target;
        const statusEl = document.getElementById('change-password-status');
        const submitButton = form.querySelector('button[type="submit"]');
    
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('profile-new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
    
        statusEl.className = 'status-message';
        statusEl.textContent = '';
    
        if (newPassword !== confirmPassword) {
            statusEl.textContent = 'New passwords do not match.';
            statusEl.className = 'status-message error-message';
            return;
        }
    
        if (newPassword.length < 6) {
            statusEl.textContent = 'New password must be at least 6 characters long.';
            statusEl.className = 'status-message error-message';
            return;
        }
    
        submitButton.disabled = true;
        submitButton.textContent = 'Changing...';
        showGlobalLoader();
    
        try {
            const response = await fetch('/api/auth/change-password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ currentPassword, newPassword })
            });
    
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to change password.');
    
            statusEl.textContent = data.message;
            statusEl.className = 'status-message success';
            form.reset();
            showGlobalPopup('Password changed successfully!');
        } catch (error) {
            statusEl.textContent = `Error: ${error.message}`;
            statusEl.className = 'status-message error-message';
        } finally {
            hideGlobalLoader();
            submitButton.disabled = false;
            submitButton.textContent = 'Change Password';
        }
    };

    const handleSingleHistoryExport = async (event) => {
        const exportButton = event.target;
        const entryId = exportButton.dataset.id;
        const uploadedAt = exportButton.dataset.uploadedAt;
        const date = new Date(uploadedAt).toISOString().split('T')[0]; // YYYY-MM-DD format

        exportButton.textContent = 'Exporting...';
        exportButton.disabled = true;
        showGlobalLoader();

        try {
            const response = await fetch(`/api/rto-status/export?id=${entryId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                let errorMsg = `Export failed with status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.message || errorMsg;
                } catch (e) {
                    // Ignore if response is not JSON, use default message
                }
                throw new Error(errorMsg);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `RTO_Status_Report_${date}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            
            showGlobalPopup('Export successful!');
        } catch (error) {
            showGlobalPopup(`Error: ${error.message}`, true);
        } finally {
            hideGlobalLoader();
            // Use a timeout to ensure the user sees the "Exporting..." message
            // before it reverts, especially on very fast successful exports.
            setTimeout(() => {
                if (exportButton) { // Check if button still exists
                    exportButton.textContent = 'Export';
                    exportButton.disabled = false;
                }
            }, 500);
        }
    };

    const handleExportUsersToCsv = () => {
        const dataToExport = getFilteredAndSortedUsers();

        if (dataToExport.length === 0) {
            showGlobalPopup('No users to export.', true);
            return;
        }

        const headers = ['User/Emp ID', 'Name', 'Email', 'Role', 'DL Owner'];
        
        const escapeCsvCell = (cell) => {
            if (cell === null || cell === undefined) {
                return '';
            }
            const str = String(cell);
            // If the string contains a comma, a double quote, or a newline, wrap it in double quotes
            // and escape existing double quotes by doubling them.
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvRows = [headers.join(',')];

        dataToExport.forEach(user => {
            const idDisplay = user.role === 'dl' ? 'N/A' : user.username;
            const nameDisplay = user.role === 'dl' ? `${user.name} (DL)` : user.name;
            const dlOwnerDisplay = user.role === 'dl' ? (user.dlOwner || 'Unknown') : 'N/A';

            const row = [idDisplay, nameDisplay, user.email, user.role, dlOwnerDisplay].map(escapeCsvCell);
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'user_list.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const logout = () => {
        token = null;
        localStorage.removeItem('token');
        window.location.href = '/index.html';
    };

    // --- Page Initialization ---
    if (document.getElementById('login-form')) {
        // --- LOGIN PAGE SCRIPT ---
        document.getElementById('login-form').addEventListener('submit', handleLogin);
    } else if (document.getElementById('content-panels')) {
        // --- DASHBOARD PAGE SCRIPT ---
        if (!token) {
            window.location.href = '/index.html';
            return; // Stop script execution
        }

        const navMenu = document.querySelector('.nav-menu');
        const contentPanels = document.querySelectorAll('.content-panel');

        const fetchDataForPanel = (panelId) => {
            if (panelId === 'user-management-container') fetchAndRenderUsers();
            if (panelId === 'dashboard-container') fetchAndDisplayRtoStatus();
            if (panelId === 'rto-history-container') fetchAndRenderHistory();
            if (panelId === 'profile-container') {
                // The profile page doesn't need to fetch data, but we can clear any status messages.
                const statusEl = document.getElementById('change-password-status');
                if (statusEl) statusEl.textContent = '';
            }
        };

        const setActivePanel = (targetId) => {
            // Deactivate all main nav items
            navMenu.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
            // Hide all content panels
            contentPanels.forEach(panel => panel.classList.add('hidden'));

            // Activate the target panel
            const activePanel = document.getElementById(targetId);
            if (activePanel) {
                activePanel.classList.remove('hidden');
                // Trigger data fetching for the newly visible panel
                fetchDataForPanel(targetId);
            }

            // Activate the corresponding main nav item, if it exists
            const activeNavItem = navMenu.querySelector(`.nav-item[data-target="${targetId}"]`);
            if (activeNavItem) {
                activeNavItem.classList.add('active');
            }
        };

        // --- Modal Logic for RTO Upload ---
        uploadConfirmationModal = document.getElementById('upload-confirmation-modal');
        if (uploadConfirmationModal) {
            closeModalButton = document.getElementById('modal-close-button');
            cancelModalButton = document.getElementById('modal-cancel-button');
            confirmModalButton = document.getElementById('modal-confirm-button');
            confirmCompletedSpan = document.getElementById('confirm-completed');
            confirmPendingSpan = document.getElementById('confirm-pending');

            closeModalButton.addEventListener('click', hideUploadModal);
            cancelModalButton.addEventListener('click', hideUploadModal);
            uploadConfirmationModal.addEventListener('click', (event) => {
                if (event.target === uploadConfirmationModal) {
                    hideUploadModal();
                }
            });
            // The click on the confirm button is what triggers the actual upload
            confirmModalButton.addEventListener('click', performRtoStatusUpload);
        }

        // --- Modal Logic for Reset Form ---
        resetConfirmationModal = document.getElementById('reset-confirmation-modal');
        if (resetConfirmationModal) {
            const resetFormButton = document.getElementById('reset-form-button');
            resetModalCloseButton = document.getElementById('reset-modal-close-button');
            resetModalCancelButton = document.getElementById('reset-modal-cancel-button');
            resetModalConfirmButton = document.getElementById('reset-modal-confirm-button');

            if (resetFormButton) resetFormButton.addEventListener('click', showResetModal);
            if (resetModalCloseButton) resetModalCloseButton.addEventListener('click', hideResetModal);
            if (resetModalCancelButton) resetModalCancelButton.addEventListener('click', hideResetModal);
            resetConfirmationModal.addEventListener('click', (event) => {
                if (event.target === resetConfirmationModal) hideResetModal();
            });
            if (resetModalConfirmButton) resetModalConfirmButton.addEventListener('click', performFormReset);
        }

        const initializeDashboardUI = () => {
            const welcomeMessage = document.getElementById('welcome-message');
            const user = parseJwt(token);
            if (!user) { logout(); return; }

            welcomeMessage.textContent = `Welcome, ${user.name}! (Role: ${user.role})`;

            // Role-based visibility for all elements with data-role
            const roleBasedElements = document.querySelectorAll('[data-role]');
            roleBasedElements.forEach(element => {
                const requiredRoles = element.dataset.role.split(' ');
                if (requiredRoles.includes(user.role)) {
                    element.classList.remove('hidden');
                } else {
                    element.classList.add('hidden');
                }
            });

            // Special visibility for the RTO upload menu item
            if (user.email !== 'RTOITVALIDATION@cognizant.com') {
                document.getElementById('nav-rto-upload').classList.add('hidden');
            }

            // Set Initial View
            const firstVisibleItem = navMenu.querySelector('.nav-item:not(.hidden)');
            if (firstVisibleItem) {
                setActivePanel(firstVisibleItem.dataset.target);
            } else {
                // If no main nav items are visible, default to the profile page.
                setActivePanel('profile-container');
            }
        };

        // Add all dashboard event listeners
        document.getElementById('logout-button').addEventListener('click', logout);
        document.getElementById('my-profile-button').addEventListener('click', (event) => {
            setActivePanel(event.target.dataset.target);
            // Close the dropdown after clicking
            document.getElementById('profile-dropdown').classList.remove('show');
        });
        document.getElementById('registration-form').addEventListener('submit', handleRegistration);
        document.getElementById('dl-creation-form').addEventListener('submit', handleDlRegistration);
        const rtoStatusUploadForm = document.getElementById('rto-status-upload-form');
        if (rtoStatusUploadForm) rtoStatusUploadForm.addEventListener('submit', handleRtoStatusUpload);

        const refreshDashboardButton = document.getElementById('refresh-dashboard-button');
        if (refreshDashboardButton) {
            refreshDashboardButton.addEventListener('click', () => {
                const icon = refreshDashboardButton.querySelector('svg');
                const textSpan = refreshDashboardButton.querySelector('.button-text');
                if (icon && textSpan) {
                    icon.classList.add('spinning');
                    textSpan.textContent = 'Refreshing...';
                    refreshDashboardButton.disabled = true;
                }
                fetchAndDisplayRtoStatus().finally(() => {
                    if (icon && textSpan) {
                        icon.classList.remove('spinning');
                        textSpan.textContent = 'Refresh';
                        refreshDashboardButton.disabled = false;
                    }
                });
            });
        }

        document.getElementById('change-password-form').addEventListener('submit', handleChangePassword);

        // --- Profile Dropdown Logic ---
        const profileMenu = document.getElementById('profile-menu');
        const profileIcon = document.getElementById('profile-icon');
        const profileDropdown = document.getElementById('profile-dropdown');

        if (profileIcon && profileDropdown && profileMenu) {
            profileIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                profileDropdown.classList.toggle('show');
            });

            // Prevent clicks inside the dropdown from closing it
            profileDropdown.addEventListener('click', (event) => {
                event.stopPropagation();
            });

            // Close dropdown if clicking outside
            document.addEventListener('click', () => {
                profileDropdown.classList.remove('show');
            });
        } // End of profile dropdown logic

        navMenu.addEventListener('click', (event) => {
            const navItem = event.target.closest('.nav-item');
            if (navItem && !navItem.classList.contains('active')) {
                setActivePanel(navItem.dataset.target);
            }
        });

        document.getElementById('user-list-body').addEventListener('click', (event) => {
            const target = event.target;
            if (target.classList.contains('delete')) {
                const userId = target.dataset.id;
                const user = userListData.find(u => u.id == userId);
                if (user) {
                    // Use a more descriptive name for the modal, like user's name or email
                    const userNameForDisplay = user.role === 'dl' ? `${user.name} (DL)` : user.name;
                    showDeleteConfirmModal(userId, userNameForDisplay || user.email);
                }
            }
        });
        document.getElementById('history-prev-button').addEventListener('click', () => {
            if (rtoHistoryCurrentPage > 1) {
                renderHistoryPage(rtoHistoryCurrentPage - 1);
            }
        });

        document.getElementById('history-next-button').addEventListener('click', () => {
            const totalPages = Math.ceil(rtoHistoryData.length / rtoHistoryItemsPerPage);
            if (rtoHistoryCurrentPage < totalPages) {
                renderHistoryPage(rtoHistoryCurrentPage + 1);
            }
        });
        document.getElementById('rto-history-body').addEventListener('click', (event) => {
            if (event.target.classList.contains('export-single-history')) {
                handleSingleHistoryExport(event);
            }
        });
        const userSearchInput = document.getElementById('user-search-input');
        if (userSearchInput) {
            userSearchInput.addEventListener('input', renderUsers);
        }

        const exportUsersCsvButton = document.getElementById('export-users-csv-button');
        if (exportUsersCsvButton) {
            exportUsersCsvButton.addEventListener('click', handleExportUsersToCsv);
        }

        const userListTable = document.getElementById('user-list-table');
        if (userListTable) {
            userListTable.querySelector('thead').addEventListener('click', (event) => {
                const target = event.target;
                if (target.tagName === 'TH' && target.classList.contains('sortable')) {
                    const sortBy = target.dataset.sortBy;
                    if (userListSortColumn === sortBy) {
                        userListSortDirection = userListSortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        userListSortColumn = sortBy;
                        userListSortDirection = 'asc';
                    }
                    renderUsers();
                }
            });
        }

        const addUserToggleButton = document.getElementById('add-user-toggle-button');
        const userRegistrationSection = document.getElementById('user-registration-section');

        if (addUserToggleButton && userRegistrationSection) {
            // Set initial button text based on the form's state on page load
            addUserToggleButton.textContent = userRegistrationSection.classList.contains('is-collapsed') ? 'Add New User' : 'Cancel';

            addUserToggleButton.addEventListener('click', () => {
                const isNowCollapsed = userRegistrationSection.classList.toggle('is-collapsed');
                addUserToggleButton.textContent = isNowCollapsed ? 'Add New User' : 'Cancel';
                if (!isNowCollapsed) {
                    document.getElementById('reg-emp-id').focus();
                }
            });
        }
        
        initializeDashboardUI(); // Set up the UI based on the user's role
    }
});