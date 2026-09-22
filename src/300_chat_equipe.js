function ensureMqttClientLoaded() {
    if (typeof mqtt !== 'undefined') return Promise.resolve();
    if (mqttLoaderPromise) return mqttLoaderPromise;

    mqttLoaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MQTT_SCRIPT_URL;
        script.async = true;
        script.crossOrigin = 'anonymous';
        const timeoutId = setTimeout(() => {
            reject(new Error('Chargement MQTT trop long'));
        }, 8000);
        script.onload = () => {
            clearTimeout(timeoutId);
            if (typeof mqtt === 'undefined') {
                reject(new Error('Librairie MQTT indisponible après chargement'));
                return;
            }
            resolve();
        };
        script.onerror = () => {
            clearTimeout(timeoutId);
            reject(new Error('Échec de chargement du client MQTT'));
        };
        document.head.appendChild(script);
    }).finally(() => {
        if (typeof mqtt === 'undefined') mqttLoaderPromise = null;
    });

    return mqttLoaderPromise;
}


function setupChatKeyboardSafeArea() {
    const chatPanel = document.getElementById('team-chat-panel');
    const messageInput = document.getElementById('chat-message-input');
    const messagesBox = document.getElementById('chat-messages');

    if (!chatPanel || !messageInput) return;

    const originalBottom = chatPanel.style.bottom || '';
    const originalMaxHeight = chatPanel.style.maxHeight || '';

    const applyKeyboardOffset = () => {
        const visualViewport = window.visualViewport;

        if (!visualViewport) {
            chatPanel.style.bottom = originalBottom || '';
            chatPanel.style.maxHeight = originalMaxHeight || '';
            return;
        }

        const keyboardOffset = Math.max(
            0,
            Math.round(window.innerHeight - visualViewport.height - visualViewport.offsetTop)
        );

        if (keyboardOffset > 40 && document.activeElement === messageInput) {
            chatPanel.style.bottom = `calc(10px + env(safe-area-inset-bottom) + ${keyboardOffset}px)`;
            chatPanel.style.maxHeight = `calc(100dvh - 20px - ${keyboardOffset}px)`;

            setTimeout(() => {
                try {
                    messageInput.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest'
                    });
                } catch (_) {}

                if (messagesBox) {
                    messagesBox.scrollTop = messagesBox.scrollHeight;
                }
            }, 80);
        } else if (document.activeElement !== messageInput) {
            chatPanel.style.bottom = originalBottom || '';
            chatPanel.style.maxHeight = originalMaxHeight || '';
        }
    };

    if (window.visualViewport && chatPanel.dataset.keyboardSafeAreaBound !== '1') {
        chatPanel.dataset.keyboardSafeAreaBound = '1';
        window.visualViewport.addEventListener('resize', applyKeyboardOffset);
        window.visualViewport.addEventListener('scroll', applyKeyboardOffset);
    }

    if (messageInput.dataset.keyboardSafeAreaBound !== '1') {
        messageInput.dataset.keyboardSafeAreaBound = '1';

        messageInput.addEventListener('focus', () => {
            setTimeout(applyKeyboardOffset, 80);
            setTimeout(applyKeyboardOffset, 220);
            setTimeout(applyKeyboardOffset, 420);
        });

        messageInput.addEventListener('input', () => {
            if (messagesBox) {
                messagesBox.scrollTop = messagesBox.scrollHeight;
            }
            setTimeout(applyKeyboardOffset, 40);
        });

        messageInput.addEventListener('blur', () => {
            setTimeout(() => {
                chatPanel.style.bottom = originalBottom || '';
                chatPanel.style.maxHeight = originalMaxHeight || '';
            }, 180);
        });
    }
}

function initializeTeamChat() {
    const panel = document.getElementById('team-chat-panel');
    const toggleButton = document.getElementById('chat-toggle-button');
    const minimizeButton = document.getElementById('chat-minimize-button');
    const clearButton = document.getElementById('chat-clear-button');
    const alertBadge = document.getElementById('chat-alert-badge');
    const offlineBadge = document.getElementById('chat-offline-badge');
    const roomInput = document.getElementById('chat-room-input');
    const userInput = document.getElementById('chat-user-input');
    const connectButton = document.getElementById('chat-connect-button');
    const sendButton = document.getElementById('chat-send-button');
    const messageInput = document.getElementById('chat-message-input');
    const messagesBox = document.getElementById('chat-messages');
    const connectionState = document.getElementById('chat-connection-state');
    const onlineUsersLabel = document.getElementById('chat-online-users');
    const clearModal = document.getElementById('chat-clear-modal');
    const clearLocalButton = document.getElementById('chat-clear-local-button');
    const clearChannelButton = document.getElementById('chat-clear-channel-button');
    const clearCancelButton = document.getElementById('chat-clear-cancel-button');
    const chatConnectModal = document.getElementById('chat-connect-modal');
    const chatConnectGpsCheckbox = document.getElementById('chat-connect-gps-checkbox');
    const chatConnectModalStatus = document.getElementById('chat-connect-modal-status');
    const chatConnectModalCancel = document.getElementById('chat-connect-modal-cancel');
    const chatConnectModalConfirm = document.getElementById('chat-connect-modal-confirm');
    const chatConnectRoomSummary = document.getElementById('chat-connect-room-summary');
    const chatConnectUserSummary = document.getElementById('chat-connect-user-summary');
    if (!panel || !toggleButton || !minimizeButton || !clearButton || !alertBadge || !offlineBadge || !roomInput || !userInput || !connectButton || !sendButton || !messageInput || !messagesBox || !connectionState || !onlineUsersLabel || !clearModal || !clearLocalButton || !clearChannelButton || !clearCancelButton || !chatConnectModal || !chatConnectGpsCheckbox || !chatConnectModalStatus || !chatConnectModalCancel || !chatConnectModalConfirm) return;

    /*
     * v11.88 — iPad/Safari : éviter l'appel du bandeau de connexion/passkey
     * au focus du champ message. On neutralise aussi les champs canal/pseudo,
     * car Safari les interprète parfois comme un formulaire de connexion.
     */
    [
        [roomInput, 'off'],
        [userInput, 'off'],
        [messageInput, 'one-time-code']
    ].forEach(([input, autocompleteValue]) => {
        input.setAttribute('autocomplete', autocompleteValue);
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('data-lpignore', 'true');
        input.setAttribute('data-1p-ignore', 'true');
    });

    setupChatKeyboardSafeArea();

    const locationShareButton = document.createElement('button');
    locationShareButton.id = 'chat-location-share-button';
    locationShareButton.type = 'button';
    locationShareButton.title = 'Partager ma position GPS avec les autres utilisateurs du canal';
    locationShareButton.style.border = '0';
    locationShareButton.style.borderRadius = '8px';
    locationShareButton.style.padding = '4px 7px';
    locationShareButton.style.fontWeight = '700';
    locationShareButton.style.cursor = 'pointer';
    locationShareButton.style.whiteSpace = 'nowrap';
    clearButton.parentNode.insertBefore(locationShareButton, clearButton);

    const validateChatConfigButton = document.createElement('button');
    validateChatConfigButton.id = 'chat-validate-config-button';
    validateChatConfigButton.type = 'button';
    validateChatConfigButton.textContent = 'Valider';
    validateChatConfigButton.title = 'Valider le changement de canal ou pseudo';
    validateChatConfigButton.className = 'chat-validate-config-button';
    validateChatConfigButton.disabled = true;
    validateChatConfigButton.style.display = 'none';
    clearButton.parentNode.insertBefore(validateChatConfigButton, clearButton);

    const CHAT_CLIENT_ID_KEY = 'teamChatClientId';
    const CHAT_OUTBOX_KEY = 'teamChatOutbox';
    const CHAT_SEEN_IDS_KEY = 'teamChatSeenIds';
    const CHAT_CONNECTION_DESIRED_KEY = 'teamChatConnectionDesired';
    let chatConnectionDesired = localStorage.getItem(CHAT_CONNECTION_DESIRED_KEY) === 'true';
    let unreadCount = 0;
    let reconnectAfterOnlineTimeout = null;
    let isChatConnecting = false;
    let hasAnnouncedConnection = true;
    const pendingChatMessages = [];
    const renderedMessageIds = new Set();
    const sentMessageElements = new Map();
    const activeUsers = new Map();
    const CHAT_RECENT_USER_MAX_AGE_MS = 30 * 60 * 1000;
    const CHAT_PRESENCE_HEARTBEAT_MS = 60 * 1000;
    let chatPresenceHeartbeatTimer = null;
    let chatRecentUsersRefreshTimer = null;
    let chatPushSubscriptionPromise = null;
    const myClientId = getOrCreateClientId();
    const CHAT_LOCATION_SHARING_KEY = 'teamChatLocationSharing';
    const CHAT_LOCATION_PUBLISH_INTERVAL_MS = 10000;
    const CHAT_LOCATION_DISPLAY_MAX_AGE_MS = 30000; // Ignore les positions retenues trop anciennes au démarrage.
    const CHAT_LOCATION_STALE_MS = 60000;
    const CHAT_LOCATION_REMOVE_MS = 300000;
    const CHAT_ALTITUDE_STALE_MS = 30000;
    let locationSharingEnabled = localStorage.getItem(CHAT_LOCATION_SHARING_KEY) === 'true';
    let locationPublishTimer = null;
    let lastLocationPublishAt = 0;
    const remoteLocationMarkers = new Map();
    minimizeButton.textContent = '✕ Fermer';
    minimizeButton.title = 'Fermer la fenêtre chat';
    minimizeButton.setAttribute('aria-label', 'Fermer la fenêtre chat');

    const defaultConfig = { room: 'Milan', user: '' };
    const savedConfig = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || 'null') || defaultConfig;
    roomInput.value = savedConfig.room || defaultConfig.room;
    userInput.value = savedConfig.user || defaultConfig.user;
    chatConnectGpsCheckbox.checked = locationSharingEnabled;

    const persistedSeenIds = new Set(JSON.parse(localStorage.getItem(CHAT_SEEN_IDS_KEY) || '[]'));
    const history = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
    history.forEach((item) => {
        if (item?.id) renderedMessageIds.add(item.id);
        appendChatMessage(item.user, item.text, item.time, item.system === true, item);
    });

    const setChatConnectionDesired = (desired) => {
        chatConnectionDesired = desired === true;
        localStorage.setItem(
            CHAT_CONNECTION_DESIRED_KEY,
            chatConnectionDesired ? 'true' : 'false'
        );
    };

    const setConnectionState = (isOnline, label = null) => {
        chatConnected = isOnline;
        const effectiveLabel = label || (isOnline ? 'Connecté' : 'Hors ligne');
        connectionState.textContent = effectiveLabel;
        connectionState.classList.toggle('online', isOnline);
        connectionState.classList.toggle('offline', !isOnline);
        offlineBadge.style.display = isOnline ? 'none' : 'flex';

        if (connectButton) {
            const connecting = effectiveLabel === 'Connexion...' || effectiveLabel === 'Reconnexion...';
            connectButton.disabled = connecting;
            connectButton.textContent = isOnline
                ? 'Déconnexion'
                : (connecting ? 'Connexion...' : (chatConnectionDesired ? 'Déconnexion' : 'Connexion'));
        }
    };
    setConnectionState(false);

    const persistConfig = () => {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
            room: (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, ''),
            user: (userInput.value || '').trim().slice(0, 24)
        }));
    };

    let lastValidatedChatConfig = {
        room: (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, ''),
        user: (userInput.value || '').trim()
    };

    const getCurrentChatConfig = () => ({
        room: (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, ''),
        user: (userInput.value || '').trim()
    });

    const setChatConnectModalStatus = (message = '', type = '') => {
        chatConnectModalStatus.textContent = String(message || '');
        chatConnectModalStatus.classList.toggle('error', type === 'error');
    };

    const persistChatConnectForm = () => {
        persistConfig();
        locationSharingEnabled = chatConnectGpsCheckbox.checked === true;
        localStorage.setItem(
            CHAT_LOCATION_SHARING_KEY,
            locationSharingEnabled ? 'true' : 'false'
        );
    };

    const openChatConnectModal = () => {
        /*
         * v15.35 — à chaque ouverture, on repart des valeurs actuellement
         * mémorisées. Au premier usage le canal vaut Milan et le pseudo est vide.
         */
        let storedConfig = null;
        try {
            storedConfig = JSON.parse(
                localStorage.getItem(CHAT_STORAGE_KEY) || 'null'
            );
        } catch (_) {}

        roomInput.value = storedConfig?.room || roomInput.value || 'Milan';
        userInput.value = storedConfig?.user || userInput.value || '';
        locationSharingEnabled =
            localStorage.getItem(CHAT_LOCATION_SHARING_KEY) === 'true';
        chatConnectGpsCheckbox.checked = locationSharingEnabled;

        if (chatConnectRoomSummary) chatConnectRoomSummary.textContent = (roomInput.value || '').trim() || '—';
        if (chatConnectUserSummary) chatConnectUserSummary.textContent = (userInput.value || '').trim() || '—';
        setChatConnectModalStatus('');
        chatConnectModal.style.display = 'flex';
        chatConnectModal.setAttribute('aria-hidden', 'false');
    };

    const closeChatConnectModal = () => {
        chatConnectModal.style.display = 'none';
        chatConnectModal.setAttribute('aria-hidden', 'true');
        setChatConnectModalStatus('');
    };

    const confirmChatConnectModal = async () => {
        persistChatConnectForm();

        const current = getCurrentChatConfig();
        if (!current.room) {
            setChatConnectModalStatus(
                'Confirme le nom du canal.',
                'error'
            );
            closeChatConnectModal();
            try { roomInput.focus(); } catch (_) {}
            return;
        }
        if (!current.user) {
            setChatConnectModalStatus(
                'Renseigne un pseudo.',
                'error'
            );
            closeChatConnectModal();
            try { userInput.focus(); } catch (_) {}
            return;
        }

        roomInput.value = current.room;
        userInput.value = current.user.slice(0, 24);
        persistChatConnectForm();

        lastValidatedChatConfig = {
            room: current.room,
            user: current.user
        };
        updateChatValidateButtonState();
        updateLocationShareButton();

        closeChatConnectModal();
        setChatConnectionDesired(true);
        setConnectionState(false, 'Connexion...');
        await connectToChat();
    };

    const updateChatValidateButtonState = () => {
        /*
         * v12.24 — plus de reconnexion automatique.
         * Le bouton Valider se dégrise uniquement quand canal ou pseudo change.
         */
        const current = getCurrentChatConfig();
        const changed = current.room !== lastValidatedChatConfig.room || current.user !== lastValidatedChatConfig.user;
        const valid = !!current.room && !!current.user;

        validateChatConfigButton.disabled = !(changed && valid);
        validateChatConfigButton.classList.toggle('is-dirty', changed && valid);
    };

    const applyChatConfigValidation = async () => {
        const current = getCurrentChatConfig();
        if (!current.room || !current.user) {
            setConnectionState(false, 'Canal/pseudo requis');
            return;
        }

        persistConfig();
        validateChatConfigButton.disabled = true;
        validateChatConfigButton.textContent = 'Validation...';

        try {
            if (chatConnected || isChatConnecting || chatClient) {
                appendChatMessage('Système', 'Paramètres chat validés — reconnexion...', new Date().toISOString(), true);
                disconnectFromChat();
                await new Promise(resolve => setTimeout(resolve, 450));
                await connectToChat();
            }

            lastValidatedChatConfig = current;
            updateChatValidateButtonState();
        } catch (error) {
            appendChatMessage('Système', `Validation chat impossible: ${error.message || error}`, new Date().toISOString(), true);
        } finally {
            validateChatConfigButton.textContent = 'Valider';
            updateChatValidateButtonState();
        }
    };

    const saveMessageInHistory = (entry) => {
        const current = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
        if (entry?.id && current.some((msg) => msg.id === entry.id)) return;
        current.push(entry);
        const recent = current.slice(-200);
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(recent));
    };

    function getOrCreateClientId() {
        const stored = localStorage.getItem(CHAT_CLIENT_ID_KEY);
        if (stored && stored.trim()) return stored;
        const created = `pelic_device_${Math.random().toString(16).slice(2, 10)}_${Date.now()}`;
        localStorage.setItem(CHAT_CLIENT_ID_KEY, created);
        return created;
    }

    const updateUnreadBadge = () => {
        if (!unreadCount) {
            alertBadge.style.display = 'none';
            return;
        }
        alertBadge.style.display = 'flex';
        alertBadge.textContent = unreadCount > 99 ? '99+' : `${unreadCount}`;
    };

    const shouldWarnUnread = () => panel.style.display !== 'flex';

    const notifyWhenInBackground = (title, body, tag = 'pelic-chat') => {
        if (typeof document === 'undefined' || !document.hidden) return;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        try {
            new Notification(title, { body, tag });
        } catch (_) {}
    };

    const isChatPushConfigured = () => {
        return typeof CHAT_PUSH_API_URL === 'string'
            && CHAT_PUSH_API_URL.trim()
            && typeof CHAT_PUSH_VAPID_PUBLIC_KEY === 'string'
            && CHAT_PUSH_VAPID_PUBLIC_KEY.trim();
    };

    const getChatPushApiUrl = (path) => {
        return `${CHAT_PUSH_API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    };

    const urlBase64ToUint8Array = (base64String) => {
        const cleaned = String(base64String || '').trim();
        const padding = '='.repeat((4 - cleaned.length % 4) % 4);
        const base64 = (cleaned + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; i += 1) {
            outputArray[i] = rawData.charCodeAt(i);
        }

        if (outputArray.length !== 65 || outputArray[0] !== 4) {
            throw new Error(`VAPID public key invalid: ${outputArray.length} bytes, first byte ${outputArray[0]}`);
        }

        return outputArray;
    };

    const ensureChatPushSubscription = async () => {
        if (chatPushSubscriptionPromise) return chatPushSubscriptionPromise;

        chatPushSubscriptionPromise = (async () => {
            if (!isChatPushConfigured()) return false;
            if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
                appendChatMessage('Système', 'Notifications push non supportées par ce navigateur.', new Date().toISOString(), true);
                return false;
            }

        const roomName = (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, '');
        const userName = (userInput.value || '').trim().slice(0, 24);
        if (!roomName || !userName) return false;

        try {
            let permission = Notification.permission;
            if (permission === 'default') {
                permission = await Notification.requestPermission();
            }
            if (permission !== 'granted') {
                appendChatMessage('Système', 'Notifications non autorisées sur cet appareil.', new Date().toISOString(), true);
                return false;
            }

            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            const vapidKeyArray = urlBase64ToUint8Array(CHAT_PUSH_VAPID_PUBLIC_KEY);
            let mustCreateNewSubscription = !subscription;

            if (subscription && subscription.options && subscription.options.applicationServerKey) {
                try {
                    const existingKey = new Uint8Array(subscription.options.applicationServerKey);
                    const sameKey = existingKey.length === vapidKeyArray.length
                        && existingKey.every((value, index) => value === vapidKeyArray[index]);

                    if (!sameKey) {
                        await subscription.unsubscribe();
                        subscription = null;
                        mustCreateNewSubscription = true;
                    }
                } catch (compareError) {
                    console.warn('Comparaison abonnement Push impossible, réabonnement forcé:', compareError);
                    try {
                        await subscription.unsubscribe();
                    } catch (_) {}
                    subscription = null;
                    mustCreateNewSubscription = true;
                }
            } else if (subscription) {
                try {
                    await subscription.unsubscribe();
                } catch (_) {}
                subscription = null;
                mustCreateNewSubscription = true;
            }

            if (mustCreateNewSubscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: vapidKeyArray
                });
            }

            const response = await fetch(getChatPushApiUrl('subscribe'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room: roomName,
                    user: userName,
                    clientId: myClientId,
                    subscription
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            localStorage.setItem('teamChatPushEnabled', 'true');
            return true;
        } catch (error) {
            console.warn('Activation Web Push impossible:', error);
            appendChatMessage('Système', `Push arrière-plan indisponible (${error.message || error}).`, new Date().toISOString(), true);
            return false;
        }
        })();

        try {
            return await chatPushSubscriptionPromise;
        } finally {
            chatPushSubscriptionPromise = null;
        }
    };

    const sendChatPushNotification = async (payload) => {
        if (!isChatPushConfigured() || !payload || payload.type !== 'chat') return;
        const roomName = (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, '');
        if (!roomName) return;

        try {
            await fetch(getChatPushApiUrl('message'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room: roomName,
                    senderClientId: myClientId,
                    user: payload.user,
                    text: payload.text,
                    time: payload.time,
                    id: payload.id
                })
            });
        } catch (error) {
            console.warn('Envoi push arrière-plan impossible:', error);
        }
    };

    const formatRecentUserAge = (timeMs) => {
        const ageSeconds = Math.max(0, Math.round((Date.now() - timeMs) / 1000));
        if (ageSeconds < 60) return `${ageSeconds} s`;
        return `${Math.round(ageSeconds / 60)} min`;
    };

    const refreshOnlineUsersLabel = () => {
        const now = Date.now();

        const users = Array.from(activeUsers.entries())
            .map(([clientId, record]) => {
                if (typeof record === 'string') {
                    return { clientId, user: record, timeMs: now, status: 'online', isSelf: clientId === myClientId };
                }
                return { ...record, clientId, isSelf: clientId === myClientId };
            })
            .filter((record) => record && typeof record.user === 'string' && record.user.trim())
            .filter((record) => Number.isFinite(record.timeMs) && (now - record.timeMs) <= CHAT_RECENT_USER_MAX_AGE_MS)
            .sort((a, b) => {
                if (a.isSelf && !b.isSelf) return -1;
                if (!a.isSelf && b.isSelf) return 1;
                return a.user.localeCompare(b.user, 'fr');
            });

        if (!users.length) {
            onlineUsersLabel.textContent = 'Vus <30 min: 0';
            onlineUsersLabel.title = 'Aucun utilisateur vu sur ce canal dans les 30 dernières minutes.';
            return;
        }

        const preview = users
            .map((record) => record.isSelf ? `${record.user}` : `${record.user} ${formatRecentUserAge(record.timeMs)}`)
            .join(', ');
        onlineUsersLabel.textContent = `Vus <30 min: ${users.length}${preview ? ` (${preview})` : ''}`;
        onlineUsersLabel.title = users
            .map((record) => record.isSelf
                ? `${record.user} — cet appareil`
                : `${record.user} — vu il y a ${formatRecentUserAge(record.timeMs)}${record.status === 'offline' ? ' (hors ligne)' : ''}`)
            .join('\n');
    };

    const publishPresence = (status, explicitUser = null) => {
        if (!chatClient || !chatPresenceTopic || !myClientId) return;
        const username = (explicitUser || userInput.value || '').trim();
        chatClient.publish(`${chatPresenceTopic}/${myClientId}`, JSON.stringify({
            type: 'presence',
            senderClientId: myClientId,
            user: username || 'inconnu',
            status,
            time: new Date().toISOString()
        }), { qos: 1, retain: true });
    };

    const startPresenceHeartbeat = () => {
        if (chatPresenceHeartbeatTimer) clearInterval(chatPresenceHeartbeatTimer);
        if (chatRecentUsersRefreshTimer) clearInterval(chatRecentUsersRefreshTimer);

        publishPresence('online');

        chatPresenceHeartbeatTimer = setInterval(() => {
            publishPresence('online');
            refreshOnlineUsersLabel();
        }, CHAT_PRESENCE_HEARTBEAT_MS);

        chatRecentUsersRefreshTimer = setInterval(refreshOnlineUsersLabel, 30 * 1000);
    };

    const stopPresenceHeartbeat = () => {
        if (chatPresenceHeartbeatTimer) {
            clearInterval(chatPresenceHeartbeatTimer);
            chatPresenceHeartbeatTimer = null;
        }
        if (chatRecentUsersRefreshTimer) {
            clearInterval(chatRecentUsersRefreshTimer);
            chatRecentUsersRefreshTimer = null;
        }
    };

    const updateLocationShareButton = () => {
        locationShareButton.textContent = locationSharingEnabled ? '📍 Position ON' : '📍 Position OFF';
        locationShareButton.style.background = locationSharingEnabled ? '#1f8f3a' : '#6b7280';
        locationShareButton.style.color = '#ffffff';
        locationShareButton.classList.toggle('active', locationSharingEnabled);
    };

    const getOwnLocationTopic = () => {
        return chatLocationTopic && myClientId ? `${chatLocationTopic}/${myClientId}` : null;
    };

    const formatLocationAge = (timeMs) => {
        const ageSeconds = Math.max(0, Math.round((Date.now() - timeMs) / 1000));
        if (ageSeconds < 60) return `${ageSeconds} s`;
        const ageMinutes = Math.round(ageSeconds / 60);
        return `${ageMinutes} min`;
    };

    const formatAltitudeLabel = (altitudeFt, altitudeTimeMs) => {
        const hasFreshAltitude = Number.isFinite(altitudeFt)
            && Number.isFinite(altitudeTimeMs)
            && (Date.now() - altitudeTimeMs) <= CHAT_ALTITUDE_STALE_MS;

        return hasFreshAltitude ? `${Math.round(altitudeFt)} ft` : '--- ft';
    };

    const buildRemoteLocationIcon = (user, timeMs, altitudeFt = null, altitudeTimeMs = null, labelOffset = { x: 0, y: 0 }) => {
        const ageMs = Date.now() - timeMs;

        let color = '#2563eb'; // Bleu : position récente < 20 s
        if (ageMs >= 20000 && ageMs < 60000) {
            color = '#f97316'; // Orange : 20 s à 1 min
        } else if (ageMs >= 60000) {
            color = '#dc2626'; // Rouge : plus de 1 min
        }

        const opacity = ageMs > CHAT_LOCATION_STALE_MS ? 0.75 : 0.98;
        const altitudeLabel = formatAltitudeLabel(altitudeFt, altitudeTimeMs);
        const label = `${escapeHtml(user || 'inconnu')}<br><span>${formatLocationAge(timeMs)}</span><br><span>${altitudeLabel}</span>`;
        const safeOffsetX = Number.isFinite(labelOffset?.x) ? labelOffset.x : 0;
        const safeOffsetY = Number.isFinite(labelOffset?.y) ? labelOffset.y : 0;

        return L.divIcon({
            className: 'chat-location-marker',
            html: `<div style="display:flex;align-items:center;gap:5px;opacity:${opacity};">
                    <div style="flex:0 0 auto;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);"></div>
                    <div style="transform:translate(${safeOffsetX}px,${safeOffsetY}px);background:#ffffff;border:1px solid ${color};border-radius:8px;padding:3px 6px;font-size:11px;line-height:1.15;font-weight:700;color:#111;box-shadow:0 1px 5px rgba(0,0,0,.25);white-space:nowrap;text-align:center;min-width:44px;">${label}</div>
                </div>`,
            iconSize: [118, 76],
            iconAnchor: [7, 38]
        });
    };

    const removeRemoteLocation = (senderClientId) => {
        const record = remoteLocationMarkers.get(senderClientId);
        if (record?.marker && map) {
            map.removeLayer(record.marker);
        }
        remoteLocationMarkers.delete(senderClientId);
    };

    const updateRemoteLocationLabelOffsets = () => {
        if (!map || !remoteLocationMarkers.size) return;

        /*
         * Anti-chevauchement v2 :
         * - on tient compte de l'étiquette de notre propre position ;
         * - on teste plusieurs positions possibles pour chaque vignette ;
         * - on choisit la première position qui ne croise pas une vignette déjà placée.
         *
         * Les ronds restent sur les vraies positions GPS. Seules les vignettes bougent.
         */
        const labelWidth = 62;
        const labelHeight = 46;
        const margin = 8;

        const makeBox = (point, offset) => ({
            left: point.x + 22 + offset.x,
            top: point.y - 23 + offset.y,
            right: point.x + 22 + offset.x + labelWidth,
            bottom: point.y - 23 + offset.y + labelHeight
        });

        const makeOwnBox = () => {
            if (!userMarker || !map) return null;
            const latLng = userMarker.getLatLng && userMarker.getLatLng();
            if (!latLng) return null;
            const point = map.latLngToLayerPoint(latLng);

            return {
                left: point.x + 22,
                top: point.y - 25,
                right: point.x + 22 + 56,
                bottom: point.y - 25 + 28
            };
        };

        const intersects = (a, b) => {
            if (!a || !b) return false;
            return !(
                a.right + margin < b.left
                || a.left - margin > b.right
                || a.bottom + margin < b.top
                || a.top - margin > b.bottom
            );
        };

        /*
         * v11.88 — étiquette utilisateurs distants :
         * position normale accolée à l'icône, comme les pélicandromes.
         * Les décalages ne servent qu'en anti-chevauchement.
         */
        const offsets = [
            { x: 0, y: 0 },
            { x: 0, y: -34 },
            { x: 0, y: 34 },
            { x: 58, y: 0 },
            { x: -72, y: 0 },
            { x: 58, y: -28 },
            { x: 58, y: 28 },
            { x: -72, y: -28 },
            { x: -72, y: 28 },
            { x: 0, y: -68 },
            { x: 0, y: 68 }
        ];

        const placedBoxes = [];
        const ownBox = makeOwnBox();
        if (ownBox) placedBoxes.push(ownBox);

        const records = Array.from(remoteLocationMarkers.entries())
            .map(([senderClientId, record]) => {
                if (!record?.marker || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
                const point = map.latLngToLayerPoint([record.lat, record.lon]);
                return { senderClientId, record, point };
            })
            .filter(Boolean)
            .sort((a, b) => (a.point.y - b.point.y) || (a.point.x - b.point.x));

        records.forEach((item) => {
            let selectedOffset = offsets[offsets.length - 1];
            let selectedBox = makeBox(item.point, selectedOffset);

            for (const offset of offsets) {
                const candidateBox = makeBox(item.point, offset);
                const collision = placedBoxes.some((box) => intersects(candidateBox, box));

                if (!collision) {
                    selectedOffset = offset;
                    selectedBox = candidateBox;
                    break;
                }
            }

            item.record.labelOffset = selectedOffset;
            item.record.marker.setIcon(buildRemoteLocationIcon(
                item.record.user,
                item.record.timeMs,
                item.record.altitudeFt,
                item.record.altitudeTimeMs,
                selectedOffset
            ));

            placedBoxes.push(selectedBox);
        });
    };


    const refreshRemoteLocationMarkers = () => {
        if (!map) return;
        remoteLocationMarkers.forEach((record, senderClientId) => {
            const ageMs = Date.now() - record.timeMs;
            if (ageMs > CHAT_LOCATION_REMOVE_MS) {
                removeRemoteLocation(senderClientId);
                return;
            }
            record.marker.setIcon(buildRemoteLocationIcon(record.user, record.timeMs, record.altitudeFt, record.altitudeTimeMs, record.labelOffset));
        });
        updateRemoteLocationLabelOffsets();
    };

    const updateRemoteLocationMarker = (payload) => {
        if (!map || !payload || payload.senderClientId === myClientId) return;
        const lat = Number(payload.lat);
        const lon = Number(payload.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const user = String(payload.user || 'inconnu').trim().slice(0, 24) || 'inconnu';
        const timeMs = Date.parse(payload.time || '');
        const safeTimeMs = Number.isFinite(timeMs) ? timeMs : Date.now();

        if ((Date.now() - safeTimeMs) > CHAT_LOCATION_DISPLAY_MAX_AGE_MS) {
            removeRemoteLocation(payload.senderClientId);
            return;
        }

        const position = [lat, lon];
        const existing = remoteLocationMarkers.get(payload.senderClientId);

        const altitudeMeters = Number(payload.altitude);
        const hasAltitude = Number.isFinite(altitudeMeters);
        const altitudeFt = hasAltitude
            ? Math.round(altitudeMeters * 3.28084)
            : (Number.isFinite(existing?.altitudeFt) ? existing.altitudeFt : null);
        const altitudeTimeMs = hasAltitude
            ? safeTimeMs
            : (Number.isFinite(existing?.altitudeTimeMs) ? existing.altitudeTimeMs : null);

        const altitudeLabel = formatAltitudeLabel(altitudeFt, altitudeTimeMs);
        const popupHtml = `<b>${escapeHtml(user)}</b><br>Position: ${formatLocationAge(safeTimeMs)}<br>${altitudeLabel}`;

        if (existing?.marker) {
            existing.marker.setLatLng(position);
            existing.marker.setIcon(buildRemoteLocationIcon(user, safeTimeMs, altitudeFt, altitudeTimeMs, existing.labelOffset));
            existing.marker.bindPopup(popupHtml);
            existing.user = user;
            existing.timeMs = safeTimeMs;
            existing.lat = lat;
            existing.lon = lon;
            existing.altitudeFt = altitudeFt;
            existing.altitudeTimeMs = altitudeTimeMs;
            existing.altitudeAccuracy = Number.isFinite(Number(payload.altitudeAccuracy)) ? Number(payload.altitudeAccuracy) : null;
            updateRemoteLocationLabelOffsets();
            return;
        }

        const marker = L.marker(position, {
            icon: buildRemoteLocationIcon(user, safeTimeMs, altitudeFt, altitudeTimeMs, { x: 0, y: 0 }),
            interactive: true
        }).bindPopup(popupHtml);

        marker.addTo(map);
        remoteLocationMarkers.set(payload.senderClientId, {
            marker,
            user,
            timeMs: safeTimeMs,
            lat,
            lon,
            altitudeFt,
            altitudeTimeMs,
            altitudeAccuracy: Number.isFinite(Number(payload.altitudeAccuracy)) ? Number(payload.altitudeAccuracy) : null,
            labelOffset: { x: 0, y: 0 }
        });
        updateRemoteLocationLabelOffsets();
    };

    const publishOwnLocationClear = () => {
        const ownTopic = getOwnLocationTopic();
        if (!chatClient || !ownTopic) return;
        chatClient.publish(ownTopic, '', { qos: 1, retain: true });
    };

    const publishOwnLocation = (pos) => {
        const ownTopic = getOwnLocationTopic();
        if (!chatClient || !chatConnected || !ownTopic || !pos?.coords) return;

        const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

        const userName = (userInput.value || '').trim().slice(0, 24) || 'inconnu';
        const payload = {
            type: 'location',
            room: (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, ''),
            senderClientId: myClientId,
            user: userName,
            lat: latitude,
            lon: longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            altitude: Number.isFinite(altitude) ? altitude : null,
            altitudeAccuracy: Number.isFinite(altitudeAccuracy) ? altitudeAccuracy : null,
            heading: Number.isFinite(heading) ? heading : null,
            speed: Number.isFinite(speed) ? speed : null,
            time: new Date().toISOString()
        };

        chatClient.publish(ownTopic, JSON.stringify(payload), { qos: 1, retain: true });
        lastLocationPublishAt = Date.now();
    };

    const requestAndPublishOwnLocation = () => {
        if (!locationSharingEnabled || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                updateUserPosition(pos);
                publishOwnLocation(pos);
            },
            (error) => {
                console.warn('Position GPS chat indisponible:', error);
                console.warn('[Chat] Position GPS indisponible:', error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
    };

    const startLocationSharing = (silent = false) => {
        if (!navigator.geolocation) {
            console.warn('[Chat] Partage position impossible: GPS non supporté.');
            return;
        }
        if (!chatClient || !chatConnected || !chatLocationTopic) {
            appendChatMessage('Système', 'Connecte le chat avant d’activer le partage de position.', new Date().toISOString(), true);
            return;
        }

        locationSharingEnabled = true;
        localStorage.setItem(CHAT_LOCATION_SHARING_KEY, 'true');
        updateLocationShareButton();

        if (locationPublishTimer) clearInterval(locationPublishTimer);
        requestAndPublishOwnLocation();
        locationPublishTimer = setInterval(requestAndPublishOwnLocation, CHAT_LOCATION_PUBLISH_INTERVAL_MS);

        if (!silent) {
            appendChatMessage('Système', 'Partage de position activé.', new Date().toISOString(), true);
        }
    };

    const stopLocationSharing = (silent = false) => {
        locationSharingEnabled = false;
        localStorage.setItem(CHAT_LOCATION_SHARING_KEY, 'false');
        updateLocationShareButton();

        if (locationPublishTimer) {
            clearInterval(locationPublishTimer);
            locationPublishTimer = null;
        }

        publishOwnLocationClear();

        if (!silent) {
            appendChatMessage('Système', 'Partage de position désactivé.', new Date().toISOString(), true);
        }
    };

    setInterval(refreshRemoteLocationMarkers, 15000);
    if (map) {
        map.on('zoomend moveend', updateRemoteLocationLabelOffsets);
    }
    updateLocationShareButton();

    const persistSeenIds = () => {
        localStorage.setItem(CHAT_SEEN_IDS_KEY, JSON.stringify(Array.from(persistedSeenIds).slice(-400)));
    };

    const updateMessageStatus = (messageId, nextStatus) => {
        if (!messageId || !sentMessageElements.has(messageId)) return;
        const statusEl = sentMessageElements.get(messageId);
        if (!statusEl) return;
        const isRead = nextStatus === 'read';
        statusEl.textContent = isRead ? '✓✓' : (nextStatus === 'sent' ? '✓' : '⏳');
        statusEl.classList.toggle('read', isRead);

        const current = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
        const index = current.findIndex((m) => m.id === messageId);
        if (index >= 0) {
            current[index].status = nextStatus;
            localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(current));
        }
    };

    const addToOutbox = (payload) => {
        const outbox = JSON.parse(localStorage.getItem(CHAT_OUTBOX_KEY) || '[]');
        outbox.push(payload);
        localStorage.setItem(CHAT_OUTBOX_KEY, JSON.stringify(outbox.slice(-100)));
    };

    const publishChatPayload = (payload, onLiveAck = null) => {
        if (!chatClient || !chatTopic || !chatHistoryTopic) return;
        chatClient.publish(chatTopic, JSON.stringify(payload), { qos: 1 }, (err) => {
            if (!err && typeof onLiveAck === 'function') onLiveAck();
        });
        chatClient.publish(`${chatHistoryTopic}/${payload.id}`, JSON.stringify(payload), { qos: 1, retain: true });

 // Push Web pour les appareils où la PWA est en arrière-plan/suspendue.
 // Cette ligne ne fait rien tant que CHAT_PUSH_API_URL et CHAT_PUSH_VAPID_PUBLIC_KEY ne sont pas configurés.
        sendChatPushNotification(payload);
    };

    const flushOutbox = () => {
        if (!chatClient || !chatConnected || !chatTopic) return;
        const outbox = JSON.parse(localStorage.getItem(CHAT_OUTBOX_KEY) || '[]');
        if (!outbox.length) return;
        outbox.forEach((payload) => {
            publishChatPayload(payload, () => updateMessageStatus(payload.id, 'sent'));
        });
        localStorage.removeItem(CHAT_OUTBOX_KEY);
        console.info(`[Chat] ${outbox.length} message(s) hors-ligne envoyé(s).`);
    };

    const renderIncomingChatMessage = (parsed, isCurrentChatTopic) => {
        if (!parsed || !parsed.id || !parsed.user || !parsed.text || !parsed.time) return;
        if (renderedMessageIds.has(parsed.id)) return;

        renderedMessageIds.add(parsed.id);
        persistedSeenIds.add(parsed.id);
        persistSeenIds();
        const isOwnMessage = parsed.senderClientId === myClientId;
        appendChatMessage(parsed.user, parsed.text, parsed.time, false, { ...parsed, isOwnMessage, status: isOwnMessage ? 'sent' : 'read' });
        saveMessageInHistory({ ...parsed, status: isOwnMessage ? 'sent' : 'read' });

        if (!isOwnMessage) {
            chatClient.publish(chatTopic, JSON.stringify({
                type: 'read_receipt',
                messageId: parsed.id,
                reader: (userInput.value || '').trim() || 'inconnu',
                time: new Date().toISOString()
            }), { qos: 1 });
        }

        if (!isOwnMessage && shouldWarnUnread()) {
            unreadCount += 1;
            updateUnreadBadge();
        }

        if (!isOwnMessage && isCurrentChatTopic) {
            notifyWhenInBackground(`Pelic Chat • ${(roomInput.value || '').trim() || 'canal'}`, `${parsed.user}: ${parsed.text}`, `pelic-chat-${chatTopic}`);
        }
    };

    const reconnectIfNeeded = (reasonLabel = 'Reconnexion...') => {
        /*
         * v14.07 — la reprise réseau / premier plan ne doit jamais annuler
         * une déconnexion volontaire de l'utilisateur.
         */
        if (!chatConnectionDesired) {
            console.info('[Chat] Reconnexion ignorée : état utilisateur = déconnecté.');
            return;
        }

        const roomName = (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, '');
        const userName = (userInput.value || '').trim();
        if (!roomName || !userName) return;
        if (chatConnected || isChatConnecting) return;
        console.info('[Chat]', reasonLabel);
        connectToChat();
    };

    async function connectToChat() {
        if (isChatConnecting) return;
        isChatConnecting = true;

        if (typeof mqtt === 'undefined') {
            try {
                console.info('[Chat] Chargement du module chat…');
                await ensureMqttClientLoaded();
            } catch (mqttError) {
                isChatConnecting = false;
                appendChatMessage('Système', `Client MQTT introuvable (${mqttError.message || mqttError}).`, new Date().toISOString(), true);
                return;
            }
        }
        const roomName = (roomInput.value || '').trim().replace(/[^a-zA-Z0-9-_]/g, '');
        const userName = (userInput.value || '').trim();
        if (!roomName || !userName) {
            appendChatMessage('Système', 'Canal et pseudo obligatoires.', new Date().toISOString(), true);
            isChatConnecting = false;
            return;
        }

        const desiredChatTopic = `pelic/chat/${roomName}`;
        if (chatClient && chatConnected && chatTopic === desiredChatTopic) {
            isChatConnecting = false;
            ensureChatPushSubscription().catch(() => {});
            return;
        }

        persistConfig();
        const previousUser = activeUsers.get(myClientId) || (userInput.value || '').trim();
        publishPresence('offline', previousUser);
        if (chatClient) {
            try { chatClient.end(true); } catch (_) {}
            chatClient = null;
        }
        activeUsers.clear();
        refreshOnlineUsersLabel();

        chatTopic = `pelic/chat/${roomName}`;
        chatHistoryTopic = `pelic/chat_history/${roomName}`;
        chatPresenceTopic = `pelic/chat_presence/${roomName}`;
        chatLocationTopic = `pelic/chat_location/${roomName}`;
        setConnectionState(false, 'Connexion...');
        hasAnnouncedConnection = false;
        pendingChatMessages.length = 0;
        chatClient = mqtt.connect(CHAT_BROKER_URL, {
            keepalive: 45,
            reconnectPeriod: 5000,
            connectTimeout: 20000,
            clean: true, // session non persistante: évite de conserver des abonnements d'anciens canaux
            protocolVersion: 4,
            clientId: myClientId,
            will: {
                topic: `${chatPresenceTopic}/${myClientId}`,
                payload: JSON.stringify({
                    type: 'presence',
                    senderClientId: myClientId,
                    user: userName,
                    status: 'offline',
                    time: new Date().toISOString()
                }),
                qos: 1,
                retain: true
            }
        });

        chatClient.on('connect', () => {
            const announceConnection = () => {
                if (hasAnnouncedConnection) return;
                hasAnnouncedConnection = true;
                setConnectionState(true);
                isChatConnecting = false;
                lastValidatedChatConfig = getCurrentChatConfig();
                updateChatValidateButtonState();
                console.info(`[Chat] Connecté au canal "${roomName}" (${CHAT_BROKER_URL}).`);

                while (pendingChatMessages.length) {
                    const pendingItem = pendingChatMessages.shift();
                    renderIncomingChatMessage(pendingItem.parsed, pendingItem.isCurrentChatTopic);
                }
            };

            chatClient.subscribe(chatTopic, { qos: 1 }, (err) => {
                if (err) {
                    setConnectionState(false, 'Erreur abonnement');
                    isChatConnecting = false;
                    appendChatMessage('Système', `Abonnement impossible: ${err.message}`, new Date().toISOString(), true);
                    return;
                }

 // On annonce la connexion dès que le canal de chat principal est prêt,
 // pour conserver un ordre visuel cohérent avec les messages reçus juste après reconnexion.
                announceConnection();
                if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    Notification.requestPermission().catch(() => {});
                }
                ensureChatPushSubscription().catch(() => {});

                chatClient.subscribe(`${chatHistoryTopic}/#`, { qos: 1 }, (historyErr) => {
                    if (historyErr) {
                        setConnectionState(false, 'Erreur historique');
                        isChatConnecting = false;
                        appendChatMessage('Système', `Abonnement historique impossible: ${historyErr.message}`, new Date().toISOString(), true);
                        return;
                    }
                    chatClient.subscribe(`${chatPresenceTopic}/#`, { qos: 1 }, (presenceErr) => {
                        if (presenceErr) {
                            setConnectionState(false, 'Erreur présence');
                            isChatConnecting = false;
                            appendChatMessage('Système', `Abonnement présence impossible: ${presenceErr.message}`, new Date().toISOString(), true);
                            return;
                        }

                        chatClient.subscribe(`${chatLocationTopic}/#`, { qos: 1 }, (locationErr) => {
                            if (locationErr) {
                                setConnectionState(false, 'Erreur positions');
                                isChatConnecting = false;
                                appendChatMessage('Système', `Abonnement positions impossible: ${locationErr.message}`, new Date().toISOString(), true);
                                return;
                            }

                            announceConnection();
                            publishPresence('online', userName);
                            startPresenceHeartbeat();
                            if (locationSharingEnabled) {
                                startLocationSharing(true);
                            }
                            flushOutbox();
                        });
                    });
                });
            });
        });

        chatClient.on('message', (receivedTopic, payload) => {
            try {
                const isCurrentChatTopic = receivedTopic === chatTopic;
                const isCurrentHistoryTopic = receivedTopic.startsWith(`${chatHistoryTopic}/`);
                const isCurrentPresenceTopic = receivedTopic.startsWith(`${chatPresenceTopic}/`);
                const isCurrentLocationTopic = chatLocationTopic && receivedTopic.startsWith(`${chatLocationTopic}/`);
                if (!isCurrentChatTopic && !isCurrentHistoryTopic && !isCurrentPresenceTopic && !isCurrentLocationTopic) return;

                const rawPayload = payload.toString();
                if (isCurrentLocationTopic && !rawPayload) {
                    removeRemoteLocation(receivedTopic.split('/').pop());
                    return;
                }

                const parsed = JSON.parse(rawPayload);
                if (!parsed || !parsed.type) return;

                if (parsed.type === 'location' && parsed.senderClientId) {
                    const locationTimeMs = Date.parse(parsed.time || '');
                    const locationAgeMs = Number.isFinite(locationTimeMs) ? (Date.now() - locationTimeMs) : Infinity;

                    if (locationAgeMs > CHAT_LOCATION_DISPLAY_MAX_AGE_MS) {
                        removeRemoteLocation(parsed.senderClientId);

 // Nettoie aussi la position conservée sur le broker MQTT pour éviter
 // qu'elle revienne brièvement à chaque ouverture de l'application.
                        if (chatClient && isCurrentLocationTopic && receivedTopic) {
                            chatClient.publish(receivedTopic, '', { qos: 1, retain: true });
                        }
                        return;
                    }

                    updateRemoteLocationMarker(parsed);
                    return;
                }

                if (parsed.type === 'read_receipt' && parsed.messageId) {
                    updateMessageStatus(parsed.messageId, 'read');
                    return;
                }

                if (parsed.type === 'presence' && parsed.senderClientId) {
                    const presenceTimeMs = Date.parse(parsed.time || '');
                    const safePresenceTimeMs = Number.isFinite(presenceTimeMs) ? presenceTimeMs : Date.now();
                    activeUsers.set(parsed.senderClientId, {
                        user: (parsed.user || '').trim() || 'inconnu',
                        timeMs: safePresenceTimeMs,
                        status: parsed.status || 'online'
                    });
                    refreshOnlineUsersLabel();
                    return;
                }

                if (parsed.type !== 'chat' || !parsed.user || !parsed.text || !parsed.time || !parsed.id) return;
                if (receivedTopic.startsWith(chatHistoryTopic)) {
                    const ageHours = Math.abs(Date.now() - new Date(parsed.time).getTime()) / 3600000;
                    if (Number.isFinite(ageHours) && ageHours > 12) {
 // Nettoyage automatique des messages retenus trop anciens (>12h) sur le canal.
                        if (parsed.id && chatClient && chatHistoryTopic) {
                            chatClient.publish(`${chatHistoryTopic}/${parsed.id}`, '', { qos: 1, retain: true });
                        }
                        return;
                    }
                }

                if (!hasAnnouncedConnection) {
                    pendingChatMessages.push({ parsed, isCurrentChatTopic });
                    return;
                }

                renderIncomingChatMessage(parsed, isCurrentChatTopic);
            } catch (_) {}
        });

        chatClient.on('reconnect', () => {
            hasAnnouncedConnection = false;
            setConnectionState(false, 'Reconnexion...');
        });
        chatClient.on('close', () => {
            stopPresenceHeartbeat();
            hasAnnouncedConnection = false;
            isChatConnecting = false;
            setConnectionState(false);
            if (locationPublishTimer) {
                clearInterval(locationPublishTimer);
                locationPublishTimer = null;
            }
            activeUsers.clear();
            refreshOnlineUsersLabel();
        });
        chatClient.on('offline', () => {
            stopPresenceHeartbeat();
            hasAnnouncedConnection = false;
            isChatConnecting = false;
            setConnectionState(false, 'Hors ligne');
            if (locationPublishTimer) {
                clearInterval(locationPublishTimer);
                locationPublishTimer = null;
            }
            activeUsers.clear();
            refreshOnlineUsersLabel();
        });
        chatClient.on('error', (err) => {
            isChatConnecting = false;
            setConnectionState(false, 'Erreur réseau');
            appendChatMessage('Système', `Erreur réseau: ${err.message}`, new Date().toISOString(), true);
        });
    }

    function disconnectFromChat() {
        stopPresenceHeartbeat();
        isChatConnecting = false;
        publishOwnLocationClear();
        publishPresence('offline', (userInput.value || '').trim());

        if (locationPublishTimer) {
            clearInterval(locationPublishTimer);
            locationPublishTimer = null;
        }

        if (chatClient) {
            const clientToClose = chatClient;
            chatClient = null;
            try { clientToClose.end(true); } catch (_) {}
        }

        activeUsers.clear();
        refreshOnlineUsersLabel();
        setConnectionState(false, 'Hors ligne');
        appendChatMessage('Système', 'Déconnecté du chat.', new Date().toISOString(), true);
    }


    function sendCurrentMessage() {
        const text = (messageInput.value || '').trim();
        const user = (userInput.value || '').trim();
        if (!text) return;
        const payload = {
            type: 'chat',
            id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            senderClientId: myClientId,
            user,
            text: text.slice(0, 280),
            time: new Date().toISOString()
        };
        renderedMessageIds.add(payload.id);
        persistedSeenIds.add(payload.id);
        persistSeenIds();
        appendChatMessage(payload.user, payload.text, payload.time, false, { ...payload, isOwnMessage: true, status: 'pending' });
        saveMessageInHistory({ ...payload, status: 'pending' });

        if (!chatClient || !chatConnected || !chatTopic) {
            addToOutbox(payload);
            console.info('[Chat] Réseau indisponible: message mis en file hors-ligne.');
            messageInput.value = '';
            return;
        }

        publishChatPayload(payload, () => updateMessageStatus(payload.id, 'sent'));
        messageInput.value = '';
    }

    const toggleChatPanel = () => {
        const visible = panel.style.display === 'flex';
        panel.style.display = visible ? 'none' : 'flex';
        if (!visible) {
            unreadCount = 0;
            updateUnreadBadge();
        }
    };
    toggleButton.addEventListener('click', toggleChatPanel);

    minimizeButton.addEventListener('click', () => {
        toggleChatPanel();
    });

    const clearLocalHistory = () => {
        messagesBox.innerHTML = '';
        localStorage.removeItem(CHAT_HISTORY_KEY);
        localStorage.removeItem(CHAT_SEEN_IDS_KEY);
        renderedMessageIds.clear();
        persistedSeenIds.clear();
        sentMessageElements.clear();
        unreadCount = 0;
        updateUnreadBadge();
    };

    const openClearModal = () => {
        clearModal.style.display = 'flex';
    };

    const closeClearModal = () => {
        clearModal.style.display = 'none';
    };

    clearButton.addEventListener('click', openClearModal);
    clearCancelButton.addEventListener('click', closeClearModal);
    clearModal.addEventListener('click', (event) => {
        if (event.target === clearModal) closeClearModal();
    });

    clearLocalButton.addEventListener('click', () => {
        clearLocalHistory();
        appendChatMessage('Système', 'Historique local supprimé.', new Date().toISOString(), true);
        closeClearModal();
    });

    clearChannelButton.addEventListener('click', () => {
        const history = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
        if (!chatClient || !chatConnected || !chatHistoryTopic) {
            alert('Connexion au canal requise pour supprimer les messages enregistrés du canal.');
            return;
        }
        const historyIds = Array.from(new Set(history.map((item) => item?.id).filter(Boolean)));
        historyIds.forEach((messageId) => {
            chatClient.publish(`${chatHistoryTopic}/${messageId}`, '', { qos: 1, retain: true });
        });
        clearLocalHistory();
        appendChatMessage('Système', `Historique local supprimé + ${historyIds.length} message(s) canal nettoyé(s).`, new Date().toISOString(), true);
        closeClearModal();
    });

    const persistChatTextFields = () => {
        persistConfig();
        updateChatValidateButtonState();
    };

    roomInput.addEventListener('input', persistChatTextFields);
    roomInput.addEventListener('change', persistChatTextFields);
    userInput.addEventListener('input', persistChatTextFields);
    userInput.addEventListener('change', persistChatTextFields);
    validateChatConfigButton.addEventListener('click', applyChatConfigValidation);
    updateChatValidateButtonState();

    chatConnectGpsCheckbox.addEventListener('change', () => {
        persistChatConnectForm();
        updateLocationShareButton();
    });

    chatConnectModalCancel.addEventListener('click', () => {
        /*
         * Même en cas d'annulation, les valeurs saisies restent mémorisées
         * conformément au comportement demandé.
         */
        persistChatConnectForm();
        closeChatConnectModal();
    });

    chatConnectModalConfirm.addEventListener('click', () => {
        confirmChatConnectModal().catch((error) => {
            setChatConnectModalStatus(
                `Connexion impossible : ${error.message || error}`,
                'error'
            );
        });
    });

    chatConnectModal.addEventListener('click', (event) => {
        if (event.target === chatConnectModal) {
            persistChatConnectForm();
            closeChatConnectModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (
            event.key === 'Escape'
            && chatConnectModal.style.display === 'flex'
        ) {
            persistChatConnectForm();
            closeChatConnectModal();
        }
    });

    [roomInput, userInput].forEach((input) => {
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            confirmChatConnectModal().catch((error) => {
                setChatConnectModalStatus(
                    `Connexion impossible : ${error.message || error}`,
                    'error'
                );
            });
        });
    });

    connectButton.addEventListener('click', () => {
        /*
         * v15.35 — connecté / connexion demandée : le bouton reste une
         * déconnexion. Hors ligne : "Connexion" ouvre d'abord la fenêtre de
         * configuration GPS / canal / pseudo.
         */
        if (chatConnectionDesired || chatConnected || isChatConnecting) {
            setChatConnectionDesired(false);
            disconnectFromChat();
            closeChatConnectModal();
        } else {
            openChatConnectModal();
        }
    });
    locationShareButton.addEventListener('click', () => {
        if (locationSharingEnabled) {
            stopLocationSharing();
        } else {
            startLocationSharing();
        }
    });
    sendButton.addEventListener('click', sendCurrentMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendCurrentMessage();
        }
    });

    window.addEventListener('online', () => {
        if (reconnectAfterOnlineTimeout) clearTimeout(reconnectAfterOnlineTimeout);
        reconnectAfterOnlineTimeout = setTimeout(() => {
            reconnectIfNeeded('Réseau récupéré, tentative de reconnexion.');
        }, 400);
    });
    window.addEventListener('offline', () => {
        if (reconnectAfterOnlineTimeout) {
            clearTimeout(reconnectAfterOnlineTimeout);
            reconnectAfterOnlineTimeout = null;
        }
        setConnectionState(false, 'Hors ligne');
        console.info('[Chat] Réseau perdu, les messages sortants seront mis en file.');
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            if (reconnectAfterOnlineTimeout) clearTimeout(reconnectAfterOnlineTimeout);
            reconnectAfterOnlineTimeout = setTimeout(() => {
                reconnectIfNeeded('Retour au premier plan, reconnexion du chat.');
            }, 200);
        }
    });

    /*
     * Restauration de l'état lors d'un démarrage complet :
     * - préférence connectée : tentative de connexion ;
     * - préférence déconnectée : maintien hors ligne.
     */
    if (chatConnectionDesired) {
        setConnectionState(false, 'Connexion...');
        setTimeout(() => {
            reconnectIfNeeded('Restauration du dernier état du chat.');
        }, 350);
    } else {
        setConnectionState(false, 'Hors ligne');
    }

    window.addEventListener('beforeunload', () => {
        publishOwnLocationClear();
        publishPresence('offline');
    });

    function getChatSenderStyle(user, isSystemMessage = false) {
    if (isSystemMessage) {
        return {
            color: '#6b7280',
            background: '#f3f4f6',
            border: '#9ca3af'
        };
    }

    const palette = [
        { color: '#1d4ed8', background: '#eff6ff', border: '#3b82f6' },
        { color: '#047857', background: '#ecfdf5', border: '#10b981' },
        { color: '#b45309', background: '#fffbeb', border: '#f59e0b' },
        { color: '#be123c', background: '#fff1f2', border: '#f43f5e' },
        { color: '#6d28d9', background: '#f5f3ff', border: '#8b5cf6' },
        { color: '#0f766e', background: '#f0fdfa', border: '#14b8a6' },
        { color: '#c2410c', background: '#fff7ed', border: '#fb923c' },
        { color: '#0369a1', background: '#f0f9ff', border: '#38bdf8' }
    ];

    const key = String(user || 'inconnu');
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash |= 0;
    }

    return palette[Math.abs(hash) % palette.length];
}

function appendChatMessage(user, text, isoTime, isSystemMessage = false, meta = null) {
        const row = document.createElement('div');
        row.className = 'chat-message';
        const time = new Date(isoTime || Date.now());
        const hh = `${time.getHours()}`.padStart(2, '0');
        const mm = `${time.getMinutes()}`.padStart(2, '0');
        const isOwnMessage = meta?.isOwnMessage === true;
        const baseStatus = meta?.status || 'sent';
        const statusSymbol = baseStatus === 'read' ? '✓✓' : (baseStatus === 'sent' ? '✓' : '⏳');
        const statusClass = baseStatus === 'read' ? 'chat-message-status read' : 'chat-message-status';
        const statusMarkup = (!isSystemMessage && isOwnMessage) ? `<span class="${statusClass}" data-message-status="${meta?.id || ''}">${statusSymbol}</span>` : '';
        const senderStyle = getChatSenderStyle(user, isSystemMessage);
        const senderLabel = isSystemMessage ? 'Système' : escapeHtml(user);

        if (!isSystemMessage) {
            row.classList.add(isOwnMessage ? 'chat-message-own' : 'chat-message-remote');
        }

        row.style.borderLeft = `4px solid ${senderStyle.border}`;
        row.style.backgroundColor = senderStyle.background;
        row.style.borderRadius = '8px';
        row.style.paddingLeft = '8px';

        row.innerHTML = `<b style="color:${senderStyle.color}">${senderLabel}</b> <span style="color:#7a7a7a">(${hh}:${mm})</span>${statusMarkup}<br>${escapeHtml(text)}`;
        messagesBox.appendChild(row);
        messagesBox.scrollTop = messagesBox.scrollHeight;
        if (meta?.id && isOwnMessage) {
            const statusEl = row.querySelector(`[data-message-status=\"${meta.id}\"]`);
            if (statusEl) sentMessageElements.set(meta.id, statusEl);
        }
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

