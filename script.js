// --- CONFIGURACIÓN ---
const AppConfig = {
    // CAMBIO V0.3.0: URL de tu API actualizada (con P2P)
    API_URL: 'https://script.google.com/macros/s/AKfycbyhPHZuRmC7_t9z20W4h-VPqVFk0z6qKFG_W-YXMgnth4BMRgi8ibAfjeOtIeR5OrFPXw/exec',
    TRANSACCION_API_URL: 'https://script.google.com/macros/s/AKfycbyhPHZuRmC7_t9z20W4h-VPqVFk0z6qK8HtmTWGcaPGWhOzGCdhbcs/exec',
    CLAVE_MAESTRA: 'PinceladasM25-26',
    SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/1GArB7I19uGum6awiRN6qK8HtmTWGcaPGWhOzGCdhbcs/edit?usp=sharing',
    INITIAL_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 30000,
    MAX_RETRIES: 5,
    CACHE_DURATION: 300000,
    
    // CAMBIO v16.1: Actualización de versión
    APP_STATUS: 'Beta', 
    APP_VERSION: 'v17.1 (Tienda Limpia)', // ACTUALIZADO A v17.1
    
    // Configuración de Firestore (Globales proporcionadas por Canvas)
    getAppId: () => typeof __app_id !== 'undefined' ? __app_id : 'default-app-id',
    getFirebaseConfig: () => {
        try {
            return JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        } catch (e) {
            console.error("Error parsing __firebase_config:", e);
            return {};
        }
    },
    getAuthToken: () => typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null,

    // Colecciones de Firestore
    getCollections: (userId) => ({
        users: `artifacts/${AppConfig.getAppId()}/public/data/users`,
        logs: `artifacts/${AppConfig.getAppId()}/public/data/logs`,
        bonos: `artifacts/${AppConfig.getAppId()}/public/data/bonos`,
        tiendaItems: `artifacts/${AppConfig.getAppId()}/public/data/tiendaItems`,
        userPrivate: `artifacts/${AppConfig.getAppId()}/users/${userId}/private`,
        // CAMBIO v17.0: Nueva colección de Compras
        compras: `artifacts/${AppConfig.getAppId()}/public/data/compras` 
    })
};

// --- ESTADO GLOBAL ---
const AppState = {
    db: null,
    auth: null,
    userId: null,
    isAdmin: false,
    users: [],
    logs: [],
    bonos: [],
    tiendaItems: [],
    compras: [], // CAMBIO v17.0: Estado para compras
    isAuthReady: false,
    
    // Estados específicos de la UI
    selectedUserId: null,
    selectedUserName: '',
    
    // CAMBIO v16.1: Tienda manual
    isStoreManual: false,
};


// --- FIREBASE/FIREBASE INITIALIZATION ---

/**
 * Inicializa Firebase y autentica al usuario.
 */
async function initializeFirebase() {
    try {
        const firebaseConfig = AppConfig.getFirebaseConfig();
        if (!firebaseConfig || !firebaseConfig.apiKey) {
            AppUI.setError(document.getElementById('auth-status-message'), "Configuración de Firebase no disponible.");
            throw new Error("Firebase configuration is missing or invalid.");
        }

        // Importaciones dinámicas (simuladas en el entorno Canvas)
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
        const { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
        const { getFirestore, doc, setDoc, collection, onSnapshot, getDoc, runTransaction, getDocs, query, where, addDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
        const { setLogLevel } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");

        // Habilitar logs para debug
        setLogLevel('debug');

        const app = initializeApp(firebaseConfig);
        AppState.db = getFirestore(app);
        AppState.auth = getAuth(app);
        
        // Listener de estado de autenticación
        onAuthStateChanged(AppState.auth, async (user) => {
            if (user) {
                AppState.userId = user.uid;
                
                // 1. Cargar configuración privada (para saber si es Admin)
                await AppUI.loadAdminStatus();

                // 2. Inicializar listeners de datos después de la autenticación
                AppUI.initDataListeners();
                
            } else {
                // Usuario deslogueado
                AppState.userId = null;
                AppState.isAdmin = false;
                AppUI.showView('login');
            }
            AppState.isAuthReady = true;
            AppUI.updateAppStatus();
        });

        // Autenticación inicial
        const authToken = AppConfig.getAuthToken();
        if (authToken) {
            await signInWithCustomToken(AppState.auth, authToken);
        } else {
            // Generar ID anónimo si no hay token (aunque Canvas siempre debería dar uno)
            await signInAnonymously(AppState.auth);
        }

    } catch (error) {
        console.error("Firebase initialization failed:", error);
        AppUI.setError(document.getElementById('auth-status-message'), "Fallo en la inicialización (ver consola)");
    }
}


// --- LÓGICA DE NEGOCIO (AppTransacciones) ---

const AppTransacciones = {

    // --- MANEJO DE BONOS (ADMIN) ---

    /**
     * Crea o actualiza un bono en Firestore.
     * @param {Object} bonoData - Datos del bono (name, cost, type, code, docId).
     */
    async crearOActualizarBono(bonoData) {
        AppUI.showLoading("Guardando bono...");
        try {
            if (!AppState.isAdmin) throw new Error("Acción no autorizada.");
            
            const collectionRef = collection(AppState.db, AppConfig.getCollections(AppState.userId).bonos);
            
            if (bonoData.docId) {
                // Actualizar
                const docRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).bonos, bonoData.docId);
                await setDoc(docRef, {
                    name: bonoData.name,
                    cost: parseInt(bonoData.cost),
                    type: bonoData.type,
                    code: bonoData.code,
                    isActive: bonoData.isActive
                }, { merge: true });
                AppUI.showNotification(`Bono "${bonoData.name}" actualizado con éxito.`);
            } else {
                // Crear
                await addDoc(collectionRef, {
                    name: bonoData.name,
                    cost: parseInt(bonoData.cost),
                    type: bonoData.type,
                    code: bonoData.code,
                    isActive: true, // Nuevo bono siempre activo
                    createdAt: new Date()
                });
                AppUI.showNotification(`Bono "${bonoData.name}" creado con éxito.`);
            }
            AppUI.hideModal('gestion-bono-modal');
        } catch (e) {
            console.error("Error al guardar bono:", e);
            AppUI.showNotification(`Error al guardar bono: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
        }
    },
    
    /**
     * Elimina un bono de Firestore.
     * @param {string} docId - ID del documento del bono a eliminar.
     */
    async eliminarBono(docId) {
        AppUI.showLoading("Eliminando bono...");
        try {
            if (!AppState.isAdmin) throw new Error("Acción no autorizada.");
            
            const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
            const docRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).bonos, docId);
            await deleteDoc(docRef);
            AppUI.showNotification("Bono eliminado con éxito.");
        } catch (e) {
            console.error("Error al eliminar bono:", e);
            AppUI.showNotification(`Error al eliminar bono: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
            AppUI.hideCustomModal(); // Asegurar que el modal de confirmación se cierra
        }
    },

    /**
     * Intenta canjear un bono de un usuario.
     * @param {string} userId - ID del usuario.
     * @param {string} bonoCode - Código del bono a canjear.
     */
    async canjearBono(userId, bonoCode) {
        AppUI.showLoading("Procesando canje de bono...");
        try {
            const user = AppState.users.find(u => u.id === userId);
            if (!user) throw new Error("Usuario no encontrado.");

            const bono = AppState.bonos.find(b => b.code === bonoCode && b.isActive);
            if (!bono) throw new Error("Código de bono inválido o inactivo.");

            // 1. Verificar si el usuario ya ha canjeado este bono (en su colección privada)
            // Usamos un doc con un ID compuesto para identificar el bono canjeado
            const userBonoDocRef = doc(AppState.db, AppConfig.getCollections(user.id).userPrivate, `bono_${bono.id}`);
            const userBonoDoc = await getDoc(userBonoDocRef);

            if (userBonoDoc.exists()) {
                throw new Error("Este bono ya ha sido canjeado por el usuario.");
            }

            // 2. Ejecutar la transacción
            const success = await AppTransacciones.ejecutarTransaccionEnUsuario(
                userId, 
                -bono.cost, 
                `Canje de Bono: ${bono.name}`, 
                'BONO',
                false // No es una transferencia P2P
            );

            if (success) {
                // 3. Registrar el canje en la colección privada del usuario
                await setDoc(userBonoDocRef, {
                    bonoId: bono.id,
                    bonoName: bono.name,
                    canjeadoEn: new Date(),
                    costo: bono.cost
                });
                
                AppUI.showNotification(`Bono "${bono.name}" canjeado con éxito. Se restaron ${bono.cost} pinceladas.`);
            } else {
                throw new Error("Fallo en la transacción de saldo.");
            }

        } catch (e) {
            console.error("Error al canjear bono:", e);
            AppUI.showNotification(`Error al canjear bono: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
            document.getElementById('canjear-bono-code').value = '';
        }
    },

    // --- MANEJO DE TIENDA (ADMIN) ---
    
    /**
     * Crea o actualiza un item de la tienda en Firestore.
     * @param {Object} itemData - Datos del item (name, cost, description, stock, docId).
     */
    async crearOActualizarItem(itemData) {
        AppUI.showLoading("Guardando item de la tienda...");
        try {
            if (!AppState.isAdmin) throw new Error("Acción no autorizada.");
            
            const collectionRef = collection(AppState.db, AppConfig.getCollections(AppState.userId).tiendaItems);
            
            // Asegurar que cost y stock son números
            itemData.cost = parseInt(itemData.cost);
            itemData.stock = parseInt(itemData.stock);
            
            if (isNaN(itemData.cost) || isNaN(itemData.stock)) {
                throw new Error("Costo y Stock deben ser números válidos.");
            }
            if (itemData.stock < -1) {
                 throw new Error("Stock no puede ser menor a -1 (ilimitado).");
            }


            if (itemData.docId) {
                // Actualizar
                const docRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).tiendaItems, itemData.docId);
                await setDoc(docRef, {
                    name: itemData.name,
                    cost: itemData.cost,
                    description: itemData.description,
                    stock: itemData.stock,
                    isActive: itemData.isActive
                }, { merge: true });
                AppUI.showNotification(`Item "${itemData.name}" actualizado con éxito.`);
            } else {
                // Crear
                await addDoc(collectionRef, {
                    name: itemData.name,
                    cost: itemData.cost,
                    description: itemData.description,
                    stock: itemData.stock,
                    isActive: true, // Nuevo item siempre activo
                    createdAt: new Date()
                });
                AppUI.showNotification(`Item "${itemData.name}" creado con éxito.`);
            }
            AppUI.hideModal('gestion-item-modal');
        } catch (e) {
            console.error("Error al guardar item:", e);
            AppUI.showNotification(`Error al guardar item: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
        }
    },

    /**
     * Elimina un item de la tienda de Firestore.
     * @param {string} docId - ID del documento del item a eliminar.
     */
    async eliminarItem(docId) {
        AppUI.showLoading("Eliminando item...");
        try {
            if (!AppState.isAdmin) throw new Error("Acción no autorizada.");
            
            const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
            const docRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).tiendaItems, docId);
            await deleteDoc(docRef);
            AppUI.showNotification("Item de la tienda eliminado con éxito.");
        } catch (e) {
            console.error("Error al eliminar item:", e);
            AppUI.showNotification(`Error al eliminar item: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
            AppUI.hideCustomModal(); // Asegurar que el modal de confirmación se cierra
        }
    },
    
    /**
     * Compra un item de la tienda para un usuario.
     * @param {string} userId - ID del usuario que compra.
     * @param {Object} item - El objeto del item comprado.
     */
    async comprarItem(userId, item) {
        AppUI.showLoading("Procesando compra...");
        try {
            if (!AppState.isAuthReady) throw new Error("Estado de autenticación no listo.");

            const user = AppState.users.find(u => u.id === userId);
            if (!user) throw new Error("Usuario no encontrado.");
            
            const cost = item.cost;

            // 1. Verificar saldo
            if (user.balance < cost) {
                throw new Error("Saldo insuficiente para esta compra.");
            }
            
            // 2. Verificar stock (solo si el stock no es -1, que significa ilimitado)
            if (item.stock !== -1 && item.stock <= 0) {
                 throw new Error("El item está agotado (Stock 0).");
            }
            
            // 3. Obtener el nombre del admin si está logueado, o 'USER_PAGO' si es el usuario
            const adminName = AppState.isAdmin ? (AppState.auth.currentUser ? AppState.auth.currentUser.uid : 'ADMIN_UNKNOWN') : 'USER_PAGO';

            // 4. Ejecutar la transacción de saldo
            const success = await AppTransacciones.ejecutarTransaccionEnUsuario(
                userId, 
                -cost, 
                `Compra de item: ${item.name}`, 
                'COMPRA',
                false
            );

            if (success) {
                // 5. Registrar la compra en la colección 'compras'
                const comprasCollectionRef = collection(AppState.db, AppConfig.getCollections(AppState.userId).compras);
                await addDoc(comprasCollectionRef, {
                    userId: userId,
                    userName: user.name,
                    itemId: item.id,
                    itemName: item.name,
                    cost: cost,
                    timestamp: new Date(),
                    adminId: adminName // Quién ejecutó la acción (Admin o el propio usuario)
                });

                // 6. Actualizar stock si no es ilimitado (-1)
                if (item.stock !== -1) {
                    const itemDocRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).tiendaItems, item.id);
                    await setDoc(itemDocRef, { stock: item.stock - 1 }, { merge: true });
                }

                AppUI.showNotification(`Compra de "${item.name}" exitosa. Se restaron ${cost} pinceladas.`);
                AppUI.hideModal('tienda-confirm-modal');
            } else {
                throw new Error("Fallo en la transacción de saldo durante la compra.");
            }

        } catch (e) {
            console.error("Error al comprar item:", e);
            AppUI.showNotification(`Error al comprar: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
        }
    },

    // --- MANEJO DEL ESTADO DE LA TIENDA (v16.1) ---

    /**
     * Alterna el estado de la tienda (manual/automático).
     */
    async toggleStoreManual() {
        AppUI.showLoading("Cambiando modo de la Tienda...");
        try {
            if (!AppState.isAdmin) throw new Error("Acción no autorizada.");

            const privateDocRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).userPrivate, 'settings');
            const newStatus = !AppState.isStoreManual;

            await setDoc(privateDocRef, { isStoreManual: newStatus }, { merge: true });
            AppState.isStoreManual = newStatus; // Actualizar estado local

            AppUI.showNotification(`Modo Tienda: ${newStatus ? 'Manual' : 'Automático'} activado.`);
            AppUI.renderAdminTienda(); // Refrescar UI
        } catch (e) {
            console.error("Error al cambiar modo de la tienda:", e);
            AppUI.showNotification(`Error: ${e.message}`, 'error');
        } finally {
            AppUI.hideLoading();
        }
    },

    // --- EJECUCIÓN CENTRAL DE TRANSACCIONES (CORE) ---

    /**
     * Ejecuta una transacción de saldo usando una transacción de Firestore
     * para garantizar la atomicidad.
     * @param {string} userId - ID del usuario.
     * @param {number} amount - Cantidad a sumar (positivo) o restar (negativo).
     * @param {string} concept - Concepto para el log.
     * @param {string} type - Tipo de transacción (AJUSTE, P2P, BONO, COMPRA).
     * @param {boolean} isP2P - Si es una transferencia P2P.
     * @param {string} [targetId] - ID del segundo usuario si es P2P.
     * @returns {Promise<boolean>} - True si la transacción fue exitosa.
     */
    async ejecutarTransaccionEnUsuario(userId, amount, concept, type = 'AJUSTE', isP2P = false, targetId = null) {
        if (!AppState.isAuthReady) return false;
        
        const userDocRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).users, userId);
        const logCollectionRef = collection(AppState.db, AppConfig.getCollections(AppState.userId).logs);

        try {
            await runTransaction(AppState.db, async (transaction) => {
                const userDoc = await transaction.get(userDocRef);
                if (!userDoc.exists()) {
                    throw new Error("Usuario no existe.");
                }

                const userData = userDoc.data();
                const currentBalance = userData.balance || 0;
                const newBalance = currentBalance + amount;

                if (newBalance < 0) {
                    throw new Error("Saldo insuficiente. La cuenta quedaría en negativo.");
                }

                // 1. Actualizar el saldo del usuario
                transaction.update(userDocRef, { balance: newBalance });
                
                // 2. Registrar la transacción en el log
                const logEntry = {
                    timestamp: new Date(),
                    userId: userId,
                    userName: userData.name,
                    amount: amount,
                    oldBalance: currentBalance,
                    newBalance: newBalance,
                    concept: concept,
                    type: type,
                    isAdmin: AppState.isAdmin,
                    adminId: AppState.userId
                };
                
                // Si es P2P, añadimos la información del otro usuario
                if (isP2P && targetId) {
                    logEntry.targetUserId = targetId;
                    
                    // Si se está transfiriendo, el log del receptor
                    if (type === 'P2P' && amount > 0) {
                        const targetUser = AppState.users.find(u => u.id === targetId);
                        logEntry.targetUserName = targetUser ? targetUser.name : 'Desconocido';
                        // El log del emisor (negativo) ya tiene el targetId
                    }
                }

                // Firestore no tiene un 'transaction.addDoc' directo, 
                // por lo que generamos un ID y usamos setDoc
                const newLogRef = doc(logCollectionRef);
                transaction.set(newLogRef, logEntry);
                
                return true;
            });
            return true;
        } catch (e) {
            console.error("Transaction failed: ", e);
            AppUI.showNotification(`Error de Transacción: ${e.message}`, 'error');
            return false;
        }
    },


    /**
     * Procesa la solicitud de Transacción Unitaria (Sumar/Restar).
     */
    async procesarTransaccionUnitaria() {
        const userId = AppState.selectedUserId;
        const form = document.getElementById('transaccion-form');
        const amount = parseInt(document.getElementById('transaccion-amount').value);
        const concept = document.getElementById('transaccion-concept').value.trim();
        const statusMsgEl = document.getElementById('transaccion-status-message');
        
        AppUI.clearStatus(statusMsgEl);
        if (!userId || isNaN(amount) || amount === 0 || !concept) {
            return AppUI.setError(statusMsgEl, "Verifica el usuario seleccionado, la cantidad y el concepto.");
        }

        const action = amount > 0 ? 'añadir' : 'restar';
        const absAmount = Math.abs(amount);

        AppUI.showCustomModal({
            title: `Confirmar ${action.charAt(0).toUpperCase() + action.slice(1)} Saldo`,
            body: `¿Estás seguro de que quieres ${action} **${absAmount} pinceladas** al usuario **${AppState.selectedUserName}** por el concepto: *${concept}*?`,
            onConfirm: async () => {
                AppUI.showLoading("Procesando transacción...");
                const success = await AppTransacciones.ejecutarTransaccionEnUsuario(
                    userId, 
                    amount, 
                    concept,
                    'AJUSTE'
                );

                if (success) {
                    AppUI.showNotification(`Transacción unitaria exitosa: ${action} ${absAmount} a ${AppState.selectedUserName}.`);
                    form.reset();
                    AppUI.navigate('dashboard'); // Volver al dashboard
                }
                AppUI.hideLoading();
            }
        });
    },
    
    /**
     * Procesa una transferencia P2P (Usuario A -> Usuario B).
     */
    async procesarTransferenciaP2P() {
        const senderId = document.getElementById('transferir-sender').value;
        const receiverId = document.getElementById('transferir-receiver').value;
        const amount = parseInt(document.getElementById('transferir-amount').value);
        const statusMsgEl = document.getElementById('transferir-status-message');

        AppUI.clearStatus(statusMsgEl);

        if (!senderId || !receiverId || isNaN(amount) || amount <= 0 || senderId === receiverId) {
            return AppUI.setError(statusMsgEl, "Verifica emisor, receptor (deben ser diferentes) y cantidad (positiva).");
        }
        
        const sender = AppState.users.find(u => u.id === senderId);
        const receiver = AppState.users.find(u => u.id === receiverId);

        if (!sender || !receiver) {
            return AppUI.setError(statusMsgEl, "Emisor o receptor no encontrado.");
        }
        if (sender.balance < amount) {
            return AppUI.setError(statusMsgEl, `${sender.name} no tiene saldo suficiente para esta transferencia.`);
        }
        
        AppUI.showCustomModal({
            title: `Confirmar Transferencia P2P`,
            body: `¿Estás seguro de transferir **${amount} pinceladas** de **${sender.name}** a **${receiver.name}**?`,
            onConfirm: async () => {
                AppUI.showLoading("Procesando transferencia P2P...");
                
                let success = false;
                
                try {
                    // 1. Transacción del Emisor (Restar)
                    const conceptSender = `Transferencia P2P a ${receiver.name}`;
                    const successSender = await AppTransacciones.ejecutarTransaccionEnUsuario(
                        senderId, 
                        -amount, 
                        conceptSender,
                        'P2P',
                        true,
                        receiverId // targetId es el receptor
                    );

                    if (!successSender) {
                        throw new Error("Fallo al restar saldo del emisor.");
                    }

                    // 2. Transacción del Receptor (Sumar)
                    const conceptReceiver = `Transferencia P2P de ${sender.name}`;
                    const successReceiver = await AppTransacciones.ejecutarTransaccionEnUsuario(
                        receiverId, 
                        amount, 
                        conceptReceiver,
                        'P2P',
                        true,
                        senderId // targetId es el emisor
                    );
                    
                    if (!successReceiver) {
                         // Esto es un error crítico ya que el emisor ya perdió el saldo.
                         // En un sistema real se necesitaría una reversión (rollback) manual o automática.
                         // Aquí solo notificaremos el fallo.
                        throw new Error("Fallo al sumar saldo al receptor. Se recomienda ajuste manual en el emisor.");
                    }
                    
                    success = true;

                } catch (e) {
                     AppUI.setError(statusMsgEl, e.message);
                } finally {
                    AppUI.hideLoading();
                }

                if (success) {
                    AppUI.showNotification(`Transferencia P2P exitosa: ${amount} de ${sender.name} a ${receiver.name}.`);
                    document.getElementById('transferir-form').reset();
                    AppUI.navigate('dashboard');
                }
            }
        });
    },

    /**
     * Procesa la solicitud de Transacción Múltiple (Solo Sumar).
     */
    async procesarTransaccionMultiple() {
        const form = document.getElementById('transaccion-multiple-form');
        const amount = parseInt(document.getElementById('multiple-amount').value);
        const concept = document.getElementById('multiple-concept').value.trim();
        const statusMsgEl = document.getElementById('multiple-status-message');
        
        AppUI.clearStatus(statusMsgEl);
        
        const checkboxes = document.querySelectorAll('#multiple-user-list input[type="checkbox"]:checked');
        const selectedUserIds = Array.from(checkboxes).map(cb => cb.value);

        if (isNaN(amount) || amount <= 0 || !concept || selectedUserIds.length === 0) {
            return AppUI.setError(statusMsgEl, "Verifica la cantidad (debe ser positiva), el concepto y selecciona al menos un usuario.");
        }

        const selectedUserNames = AppState.users
            .filter(u => selectedUserIds.includes(u.id))
            .map(u => u.name);
            
        const userListText = selectedUserNames.length > 5 
            ? `${selectedUserNames.slice(0, 5).join(', ')} y ${selectedUserNames.length - 5} más`
            : selectedUserNames.join(', ');

        AppUI.showCustomModal({
            title: `Confirmar Transacción Múltiple`,
            body: `¿Estás seguro de añadir **${amount} pinceladas** a ${selectedUserIds.length} usuarios (${userListText}) por el concepto: *${concept}*?`,
            onConfirm: async () => {
                AppUI.showLoading("Procesando transacciones múltiples...");
                let successfulCount = 0;
                let failedUsers = [];

                for (const userId of selectedUserIds) {
                    const success = await AppTransacciones.ejecutarTransaccionEnUsuario(
                        userId, 
                        amount, 
                        concept,
                        'MULTIPLE'
                    );
                    
                    if (success) {
                        successfulCount++;
                    } else {
                        const failedUser = AppState.users.find(u => u.id === userId);
                        failedUsers.push(failedUser ? failedUser.name : userId);
                    }
                }
                
                AppUI.hideLoading();
                
                if (successfulCount > 0) {
                    AppUI.showNotification(`Transacciones múltiples exitosas: ${successfulCount} usuarios actualizados.`);
                    form.reset();
                    AppUI.navigate('dashboard');
                }
                
                if (failedUsers.length > 0) {
                     AppUI.setError(statusMsgEl, `Fallo en ${failedUsers.length} transacciones: ${failedUsers.join(', ')}.`);
                }
            }
        });
    },
    
    /**
     * Intenta registrar un nuevo usuario con un nombre de fantasía.
     */
    async registrarNuevoUsuario() {
        const name = document.getElementById('new-user-name').value.trim();
        const statusMsgEl = document.getElementById('new-user-status-message');
        
        AppUI.clearStatus(statusMsgEl);
        
        if (!name) {
            return AppUI.setError(statusMsgEl, "El nombre no puede estar vacío.");
        }
        
        if (AppState.users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
            return AppUI.setError(statusMsgEl, `El nombre de usuario "${name}" ya existe.`);
        }
        
        AppUI.showLoading("Registrando usuario...");
        try {
             // El ID es generado automáticamente por Firestore
             const usersCollectionRef = collection(AppState.db, AppConfig.getCollections(AppState.userId).users);
             
             await addDoc(usersCollectionRef, {
                 name: name,
                 balance: 0,
                 isAdmin: false,
                 createdAt: new Date()
             });
             
             AppUI.showNotification(`Usuario "${name}" registrado con éxito.`);
             document.getElementById('new-user-name').value = '';
        } catch (e) {
            console.error("Error al registrar usuario:", e);
            AppUI.setError(statusMsgEl, `Fallo al registrar usuario: ${e.message}`);
        } finally {
            AppUI.hideLoading();
        }
    }
};


// --- UTILIDADES DE FORMATO ---
const AppFormat = {
    /**
     * Formatea un número como moneda (sin símbolo, pero con comas).
     * @param {number} num - Número de pinceladas.
     * @returns {string} - Número formateado.
     */
    formatBalance: function(num) {
        if (num === undefined || num === null) return '0';
        return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(num);
    },
    
    /**
     * Formatea una fecha/timestamp a una cadena legible.
     * @param {Date|Object} timestamp - Objeto Date o Firestore Timestamp.
     * @returns {string} - Cadena de fecha y hora.
     */
    formatDate: function(timestamp) {
        let date;
        if (timestamp && timestamp.toDate) {
            date = timestamp.toDate();
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else {
            return 'Fecha inválida';
        }
        
        const options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        };
        return date.toLocaleTimeString('es-ES', options);
    },
    
    /**
     * Genera la etiqueta HTML para el tipo de transacción.
     * @param {string} type - Tipo de transacción.
     * @returns {string} - HTML span con colores.
     */
    formatLogType: function(type) {
        let colorClass = '';
        let displayText = type;
        
        switch (type) {
            case 'AJUSTE':
                colorClass = 'bg-yellow-100 text-yellow-800';
                displayText = 'Ajuste Manual';
                break;
            case 'MULTIPLE':
                colorClass = 'bg-blue-100 text-blue-800';
                displayText = 'Ajuste Múltiple';
                break;
            case 'P2P':
                colorClass = 'bg-indigo-100 text-indigo-800';
                displayText = 'P2P Transferencia';
                break;
            case 'BONO':
                colorClass = 'bg-green-100 text-green-800';
                displayText = 'Canje de Bono';
                break;
            case 'COMPRA': // CAMBIO v17.0
                colorClass = 'bg-red-100 text-red-800';
                displayText = 'Compra Tienda';
                break;
            default:
                colorClass = 'bg-gray-100 text-gray-800';
                break;
        }
        
        return `<span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${colorClass}">${displayText}</span>`;
    },
    
    /**
     * Genera la etiqueta HTML para el estado de un item.
     * @param {boolean} isActive - Si el item está activo.
     * @returns {string} - HTML span con colores.
     */
    formatActiveStatus: function(isActive) {
        const colorClass = isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
        const displayText = isActive ? 'Activo' : 'Inactivo';
        return `<span class="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${colorClass}">${displayText}</span>`;
    },
    
    /**
     * Formatea el stock de la tienda.
     * @param {number} stock - Cantidad en stock.
     * @returns {string} - Texto formateado.
     */
    formatStock: function(stock) {
        if (stock === -1) {
            return 'Ilimitado';
        }
        return AppFormat.formatBalance(stock);
    }
};

// --- MANEJO DE LA INTERFAZ DE USUARIO (AppUI) ---
const AppUI = {

    // --- UTILS ---
    
    /**
     * Carga el estado de Admin y la configuración privada.
     */
    loadAdminStatus: async function() {
        if (!AppState.userId) return;
        
        try {
            const privateDocRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).userPrivate, 'settings');
            const docSnap = await getDoc(privateDocRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                AppState.isAdmin = data.isAdmin === true;
                AppState.isStoreManual = data.isStoreManual === true; // v16.1
            } else {
                // Si el documento no existe, asumimos que no es admin y lo creamos
                AppState.isAdmin = false;
                await setDoc(privateDocRef, { isAdmin: false, isStoreManual: false });
            }
            
            this.updateUIVisibility();

        } catch (e) {
            console.error("Error loading admin status:", e);
            AppState.isAdmin = false;
        }
    },

    /**
     * Muestra el overlay de carga.
     * @param {string} message - Mensaje a mostrar.
     */
    showLoading: function(message = "Cargando...") {
        document.getElementById('loading-message').textContent = message;
        document.getElementById('loading-overlay').classList.remove('hidden');
    },

    /**
     * Oculta el overlay de carga.
     */
    hideLoading: function() {
        document.getElementById('loading-overlay').classList.add('hidden');
    },
    
    /**
     * Muestra una notificación temporal.
     * @param {string} message - Mensaje.
     * @param {'success'|'error'} type - Tipo de notificación.
     */
    showNotification: function(message, type = 'success') {
        const notification = document.getElementById('custom-notification');
        const iconContainer = document.getElementById('notification-icon');
        
        notification.textContent = message;
        
        if (type === 'success') {
            notification.className = 'fixed bottom-4 right-4 bg-green-600 text-white p-4 rounded-xl shadow-lg transition-transform transform translate-y-full z-50';
            iconContainer.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
            notification.classList.remove('bg-red-600');
            notification.classList.add('bg-green-600');
        } else {
            notification.className = 'fixed bottom-4 right-4 bg-red-600 text-white p-4 rounded-xl shadow-lg transition-transform transform translate-y-full z-50';
            iconContainer.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
            notification.classList.remove('bg-green-600');
            notification.classList.add('bg-red-600');
        }

        // Mostrar
        setTimeout(() => {
            notification.classList.remove('translate-y-full');
            notification.classList.add('translate-y-0');
        }, 50);

        // Ocultar después de 5 segundos
        setTimeout(() => {
            notification.classList.remove('translate-y-0');
            notification.classList.add('translate-y-full');
        }, 5000);
    },
    
    /**
     * Muestra el modal de confirmación personalizado.
     * @param {Object} options - { title, body, onConfirm }
     */
    showCustomModal: function(options) {
        document.getElementById('custom-confirm-title').textContent = options.title || "Confirmar";
        
        const bodyEl = document.getElementById('custom-confirm-body');
        bodyEl.innerHTML = options.body || "¿Está seguro de realizar esta acción?";
        
        const confirmBtn = document.getElementById('custom-confirm-btn');
        // Quitar listeners previos
        confirmBtn.onclick = null; 
        
        // Asignar nuevo listener y cerrar modal después
        confirmBtn.onclick = () => {
            options.onConfirm();
            this.hideCustomModal();
        };

        document.getElementById('custom-confirm-modal').classList.remove('hidden');
    },

    /**
     * Oculta el modal de confirmación personalizado.
     */
    hideCustomModal: function() {
        document.getElementById('custom-confirm-modal').classList.add('hidden');
    },
    
    /**
     * Muestra un modal por ID.
     * @param {string} modalId - ID del contenedor del modal.
     */
    showModal: function(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    },

    /**
     * Oculta un modal por ID.
     * @param {string} modalId - ID del contenedor del modal.
     */
    hideModal: function(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    },

    /**
     * Limpia un mensaje de estado.
     * @param {HTMLElement} statusMsgEl - Elemento donde se muestra el estado.
     */
    clearStatus: function(statusMsgEl) {
        if (statusMsgEl) {
            statusMsgEl.textContent = "";
            statusMsgEl.className = "text-sm text-center font-medium h-auto min-h-[1rem]";
        }
    },
    
    /**
     * Muestra un mensaje de éxito.
     * @param {HTMLElement} statusMsgEl - Elemento donde se muestra el estado.
     * @param {string} message - Mensaje de éxito.
     */
    setSuccess: function(statusMsgEl, message) {
        if (statusMsgEl) {
            statusMsgEl.textContent = message;
            statusMsgEl.className = "text-sm text-center font-medium text-green-600 h-auto min-h-[1rem]";
        }
    },

    /**
     * Muestra un mensaje de error.
     * @param {HTMLElement} statusMsgEl - Elemento donde se muestra el estado.
     * @param {string} message - Mensaje de error.
     */
    setError: function(statusMsgEl, message) {
        if (statusMsgEl) {
            statusMsgEl.textContent = `Error: ${message}`;
            statusMsgEl.className = "text-sm text-center font-medium text-red-600 h-auto min-h-[1em]";
        }
    },


    // --- NAVEGACIÓN Y VISTAS ---

    /**
     * Navega a una vista específica.
     * @param {string} viewId - ID de la vista (ej: 'dashboard', 'logs').
     */
    navigate: function(viewId) {
        // Ocultar todas las vistas
        document.querySelectorAll('.app-view').forEach(view => {
            view.classList.add('hidden');
        });

        // Mostrar la vista solicitada
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.remove('hidden');
        } else {
            console.error(`Vista no encontrada: ${viewId}`);
        }
        
        // Actualizar la lista de usuarios si es una vista de acción
        if (viewId === 'transacciones-wrapper') {
            this.renderUserDropdown('transaccion-user-list');
            document.getElementById('transaccion-user-list').value = AppState.selectedUserId || '';
        } else if (viewId === 'transferir') {
            this.renderUserDropdown('transferir-sender', AppState.users);
            this.renderUserDropdown('transferir-receiver', AppState.users);
        } else if (viewId === 'transaccion-multiple') {
            this.renderMultipleUserList();
        } else if (viewId === 'dashboard') {
             // Limpiar selección de usuario para transacciones
             AppState.selectedUserId = null;
             AppState.selectedUserName = '';
             this.renderDashboard();
        } else if (viewId === 'logs') {
            this.renderLogs();
        } else if (viewId === 'bonos') {
            this.renderBonos();
        } else if (viewId === 'tienda') {
            this.renderTienda();
        }
        
        this.updateNavBarStyles(viewId);
    },
    
    /**
     * Actualiza el estilo de los botones de navegación.
     * @param {string} currentViewId - ID de la vista actual.
     */
    updateNavBarStyles: function(currentViewId) {
        // Escritorio
        document.querySelectorAll('#nav-bar button').forEach(btn => {
            if (btn.dataset.view === currentViewId) {
                btn.classList.add('bg-indigo-600', 'font-semibold');
                btn.classList.remove('text-indigo-200');
            } else {
                btn.classList.remove('bg-indigo-600', 'font-semibold');
                btn.classList.add('text-indigo-200');
            }
        });

        // Móvil
        document.querySelectorAll('#nav-bar-mobile button').forEach(btn => {
            if (btn.dataset.view === currentViewId) {
                btn.classList.add('bg-indigo-800', 'text-white', 'font-semibold');
                btn.classList.remove('bg-indigo-100', 'text-indigo-800');
            } else {
                btn.classList.remove('bg-indigo-800', 'text-white', 'font-semibold');
                btn.classList.add('bg-indigo-100', 'text-indigo-800');
            }
        });
    },

    /**
     * Actualiza la visibilidad de la UI basada en el estado de Admin.
     */
    updateUIVisibility: function() {
        const adminElements = document.querySelectorAll('.admin-only');
        const loginContainer = document.getElementById('login-container');
        const mainContent = document.getElementById('main-content');
        const navBar = document.getElementById('nav-bar');
        const navBarMobile = document.getElementById('nav-bar-mobile');
        const newAdminBtn = document.getElementById('new-admin-btn');

        if (AppState.isAdmin) {
            adminElements.forEach(el => el.classList.remove('hidden'));
            loginContainer.classList.add('hidden');
            mainContent.classList.remove('hidden');
            navBar.classList.remove('hidden');
            navBarMobile.classList.remove('hidden');
            newAdminBtn.classList.add('hidden'); // Ocultar botón de admin una vez logueado

            // Asegurar que estamos en una vista de admin si no estamos en 'login'
            if (document.querySelector('.app-view:not(.hidden)') === document.getElementById('login-container')) {
                 this.navigate('dashboard');
            }
        } else {
            adminElements.forEach(el => el.classList.add('hidden'));
            loginContainer.classList.remove('hidden');
            mainContent.classList.add('hidden');
            navBar.classList.add('hidden');
            navBarMobile.classList.add('hidden');
            newAdminBtn.classList.remove('hidden');
            this.navigate('login-container');
        }
    },
    
    /**
     * Inicializa los listeners de datos de Firestore.
     */
    initDataListeners: function() {
        if (!AppState.db || !AppState.userId || !AppState.isAuthReady) return;

        // 1. USERS Listener
        const usersCol = collection(AppState.db, AppConfig.getCollections(AppState.userId).users);
        onSnapshot(usersCol, (snapshot) => {
            AppState.users = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data(), 
                balance: doc.data().balance || 0, // Asegurar que el saldo es 0 si no existe
                isAdmin: doc.data().isAdmin || false,
                name: doc.data().name || 'Usuario Desconocido' // Asegurar el nombre
            }));
            
            // Ordenar por nombre
            AppState.users.sort((a, b) => a.name.localeCompare(b.name));
            
            this.renderDashboard();
            this.renderUserDropdown('transaccion-user-list', AppState.users);
            this.renderUserDropdown('transferir-sender', AppState.users);
            this.renderUserDropdown('transferir-receiver', AppState.users);
            this.renderUserDropdown('canjear-bono-user', AppState.users);
        }, (error) => {
            console.error("Error fetching users:", error);
        });
        
        // Solo para Admin: LOGS Listener
        if (AppState.isAdmin) {
            const logsCol = collection(AppState.db, AppConfig.getCollections(AppState.userId).logs);
            // Firestore no tiene 'orderBy' sin índice, por lo que cargaremos y ordenaremos en memoria
            onSnapshot(logsCol, (snapshot) => {
                AppState.logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Ordenar por timestamp (más reciente primero)
                AppState.logs.sort((a, b) => {
                    const dateA = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate() : new Date(0);
                    const dateB = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate() : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                this.renderLogs();
            }, (error) => {
                console.error("Error fetching logs:", error);
            });
            
            // BONOS Listener
            const bonosCol = collection(AppState.db, AppConfig.getCollections(AppState.userId).bonos);
            onSnapshot(bonosCol, (snapshot) => {
                AppState.bonos = snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data(),
                    isActive: doc.data().isActive !== false // Default true
                }));
                this.renderBonos();
            }, (error) => {
                console.error("Error fetching bonos:", error);
            });
            
            // TIENDA Listener
            const tiendaCol = collection(AppState.db, AppConfig.getCollections(AppState.userId).tiendaItems);
            onSnapshot(tiendaCol, (snapshot) => {
                AppState.tiendaItems = snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data(),
                    isActive: doc.data().isActive !== false,
                    cost: doc.data().cost || 0,
                    stock: doc.data().stock !== undefined ? doc.data().stock : -1 // Default Ilimitado
                }));
                this.renderTienda();
                this.renderAdminTienda(); // Refrescar vista de admin de tienda
            }, (error) => {
                console.error("Error fetching tienda items:", error);
            });
            
            // COMPRAS Listener (para el panel de Admin)
            const comprasCol = collection(AppState.db, AppConfig.getCollections(AppState.userId).compras);
            onSnapshot(comprasCol, (snapshot) => {
                AppState.compras = snapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data()
                }));
                AppState.compras.sort((a, b) => {
                    const dateA = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate() : new Date(0);
                    const dateB = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate() : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                this.renderAdminTienda();
            }, (error) => {
                console.error("Error fetching compras:", error);
            });

        } // Fin de listeners de Admin
    },

    // --- RENDERS ---
    
    /**
     * Renderiza la tabla de usuarios en el Dashboard.
     */
    renderDashboard: function() {
        const tableBody = document.getElementById('user-table-body');
        if (!tableBody) return;
        
        let html = '';
        AppState.users.forEach(user => {
            const isSelected = AppState.selectedUserId === user.id;
            
            let actionButton = '';
            if (AppState.isAdmin) {
                 actionButton = `
                    <button onclick="AppUI.handleSelectUser('${user.id}', '${user.name}')" 
                            class="px-3 py-1 text-xs font-semibold rounded-full ${isSelected ? 'bg-indigo-700 text-white hover:bg-indigo-800' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'} transition duration-150">
                        ${isSelected ? 'Seleccionado' : 'Transacción'}
                    </button>
                 `;
            }

            html += `
                <tr class="border-b transition duration-300 hover:bg-indigo-50 ${isSelected ? 'bg-indigo-100' : 'bg-white'}">
                    <td class="px-6 py-3 font-semibold text-gray-900">${user.name}</td>
                    <td class="px-6 py-3 whitespace-nowrap text-right">
                        <span class="text-lg font-bold ${user.balance >= 0 ? 'text-green-600' : 'text-red-600'}">
                            ${AppFormat.formatBalance(user.balance)}
                        </span>
                    </td>
                    <td class="px-6 py-3 whitespace-nowrap text-right">${actionButton}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = html;
        
        // Actualizar el card de Transacción si hay un usuario seleccionado
        this.renderTransaccionCard();
    },
    
    /**
     * Renderiza el card de transacción unitaria.
     */
    renderTransaccionCard: function() {
        const card = document.getElementById('transaccion-card');
        const userDisplay = document.getElementById('transaccion-user-display');
        const form = document.getElementById('transaccion-form');
        
        if (!card || !userDisplay || !form) return;

        if (AppState.selectedUserId) {
            userDisplay.textContent = AppState.selectedUserName;
            card.classList.remove('hidden');
            
            // Enfocarse en la cantidad para empezar la transacción rápidamente
            document.getElementById('transaccion-amount').focus();
        } else {
            card.classList.add('hidden');
            userDisplay.textContent = '';
            form.reset();
            this.clearStatus(document.getElementById('transaccion-status-message'));
        }
    },

    /**
     * Renderiza la tabla de Logs.
     */
    renderLogs: function() {
        const tableBody = document.getElementById('logs-table-body');
        if (!tableBody) return;
        
        let html = '';
        AppState.logs.slice(0, 50).forEach(log => { // Mostrar solo los 50 más recientes
            const amountColor = log.amount >= 0 ? 'text-green-600' : 'text-red-600';
            const sign = log.amount > 0 ? '+' : '';
            const isP2PSender = log.type === 'P2P' && log.amount < 0;
            const isP2PReceiver = log.type === 'P2P' && log.amount > 0;
            
            let conceptDisplay = log.concept;
            
            if (isP2PSender && log.targetUserId) {
                 const targetUser = AppState.users.find(u => u.id === log.targetUserId);
                 conceptDisplay = `Transferencia a ${targetUser ? targetUser.name : 'Desconocido'}`;
            } else if (isP2PReceiver && log.targetUserId) {
                 const targetUser = AppState.users.find(u => u.id === log.targetUserId);
                 conceptDisplay = `Transferencia de ${targetUser ? targetUser.name : 'Desconocido'}`;
            }

            html += `
                <tr class="border-b transition duration-300 hover:bg-gray-50 bg-white text-sm">
                    <td class="px-6 py-3 font-medium text-gray-900">${AppFormat.formatDate(log.timestamp)}</td>
                    <td class="px-6 py-3 whitespace-nowrap">${log.userName}</td>
                    <td class="px-6 py-3 whitespace-nowrap text-right font-bold ${amountColor}">${sign}${AppFormat.formatBalance(log.amount)}</td>
                    <td class="px-6 py-3">${log.oldBalance !== undefined ? AppFormat.formatBalance(log.oldBalance) : '-'} &rarr; ${log.newBalance !== undefined ? AppFormat.formatBalance(log.newBalance) : '-'}</td>
                    <td class="px-6 py-3">${AppFormat.formatLogType(log.type)}</td>
                    <td class="px-6 py-3">${conceptDisplay}</td>
                    <td class="px-6 py-3 text-xs text-gray-500">${log.isAdmin ? (log.adminId || 'Admin') : 'Usuario'}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = html;
        
        document.getElementById('logs-count').textContent = AppState.logs.length;
    },
    
    /**
     * Renderiza la vista de Gestión de Bonos (Admin y Canje).
     */
    renderBonos: function() {
        const bonosAdminBody = document.getElementById('bonos-admin-table-body');
        const bonosListContainer = document.getElementById('bonos-canje-list');
        const bonosAdminTable = document.getElementById('bonos-admin-table');
        
        if (AppState.isAdmin) {
             bonosAdminTable.classList.remove('hidden');
             let htmlAdmin = '';
             AppState.bonos.forEach(bono => {
                 htmlAdmin += `
                    <tr class="border-b transition duration-300 hover:bg-gray-50 bg-white text-sm">
                        <td class="px-6 py-3 font-medium text-gray-900">${bono.name}</td>
                        <td class="px-6 py-3 text-right font-bold text-red-600">-${AppFormat.formatBalance(bono.cost)}</td>
                        <td class="px-6 py-3 whitespace-nowrap font-mono text-xs">${bono.code}</td>
                        <td class="px-6 py-3">${AppFormat.formatActiveStatus(bono.isActive)}</td>
                        <td class="px-6 py-3 whitespace-nowrap text-right space-x-2">
                            <button onclick="AppUI.handleEditBono('${bono.id}')" 
                                    class="text-indigo-600 hover:text-indigo-900 font-semibold text-sm">
                                Editar
                            </button>
                            <button onclick="AppUI.handleDeleteConfirmation('bono', '${bono.id}', '${bono.name}')" 
                                    class="text-red-600 hover:text-red-900 font-semibold text-sm">
                                Eliminar
                            </button>
                        </td>
                    </tr>
                 `;
             });
             bonosAdminBody.innerHTML = htmlAdmin;
        } else {
            bonosAdminTable.classList.add('hidden');
        }
        
        // Renderizar la lista para Canje
        let htmlCanje = '';
        const bonosActivos = AppState.bonos.filter(b => b.isActive).sort((a, b) => a.cost - b.cost);
        if (bonosActivos.length === 0) {
            htmlCanje = '<p class="text-center text-gray-500 py-4">No hay bonos activos disponibles para canjear.</p>';
        } else {
             bonosActivos.forEach(bono => {
                 htmlCanje += `
                    <div class="bg-white p-4 rounded-xl shadow-md border-2 border-indigo-100">
                        <h3 class="text-lg font-bold text-gray-900">${bono.name}</h3>
                        <p class="text-sm text-gray-500 mb-2">${bono.type}</p>
                        <p class="text-2xl font-extrabold text-red-600 my-2">-${AppFormat.formatBalance(bono.cost)} Pinceladas</p>
                        <div class="flex justify-between items-center pt-2 border-t border-gray-100">
                            <p class="text-xs text-gray-700 font-mono">CÓDIGO: <strong>${bono.code}</strong></p>
                        </div>
                    </div>
                 `;
             });
        }
        bonosListContainer.innerHTML = htmlCanje;
    },
    
    /**
     * Renderiza la vista de la Tienda (Compras para Usuario, Gestión para Admin).
     */
    renderTienda: function() {
        // Renderizar vista de usuario (Compras)
        this.renderUserTienda();
        
        // Renderizar vista de admin (Gestión, solo si es admin)
        this.renderAdminTienda();
    },

    /**
     * Renderiza el panel de gestión de la tienda (solo Admin).
     */
    renderAdminTienda: function() {
         const adminTiendaContainer = document.getElementById('tienda-admin-container');
         const adminTiendaItemsBody = document.getElementById('tienda-admin-items-body');
         const comprasLogsBody = document.getElementById('compras-logs-body');
         const toggleBtn = document.getElementById('toggle-store-manual-btn');
         
         if (!AppState.isAdmin) {
             adminTiendaContainer.classList.add('hidden');
             return;
         }
         adminTiendaContainer.classList.remove('hidden');
         
         // 1. Botón de Toggle Manual/Automático (v16.1)
         if (toggleBtn) {
             toggleBtn.textContent = AppState.isStoreManual ? 'Cambiar a Modo Automático' : 'Cambiar a Modo Manual';
             toggleBtn.classList.toggle('bg-red-500', AppState.isStoreManual);
             toggleBtn.classList.toggle('hover:bg-red-600', AppState.isStoreManual);
             toggleBtn.classList.toggle('bg-green-500', !AppState.isStoreManual);
             toggleBtn.classList.toggle('hover:bg-green-600', !AppState.isStoreManual);
         }


         // 2. Tabla de Items de la Tienda
         let htmlItems = '';
         AppState.tiendaItems.forEach(item => {
             htmlItems += `
                <tr class="border-b transition duration-300 hover:bg-gray-50 bg-white text-sm">
                    <td class="px-6 py-3 font-medium text-gray-900">${item.name}</td>
                    <td class="px-6 py-3 text-right font-bold text-red-600">-${AppFormat.formatBalance(item.cost)}</td>
                    <td class="px-6 py-3 text-center">${AppFormat.formatStock(item.stock)}</td>
                    <td class="px-6 py-3">${AppFormat.formatActiveStatus(item.isActive)}</td>
                    <td class="px-6 py-3 whitespace-nowrap text-right space-x-2">
                        <button onclick="AppUI.handleEditItem('${item.id}')" 
                                class="text-indigo-600 hover:text-indigo-900 font-semibold text-sm">
                            Editar
                        </button>
                        <button onclick="AppUI.handleDeleteConfirmation('item', '${item.id}', '${item.name}')" 
                                class="text-red-600 hover:text-red-900 font-semibold text-sm">
                            Eliminar
                        </button>
                    </td>
                </tr>
             `;
         });
         adminTiendaItemsBody.innerHTML = htmlItems;
         
         // 3. Log de Compras
         let htmlCompras = '';
         AppState.compras.slice(0, 50).forEach(compra => {
             htmlCompras += `
                <tr class="border-b transition duration-300 hover:bg-gray-50 bg-white text-sm">
                    <td class="px-6 py-3 font-medium text-gray-900">${AppFormat.formatDate(compra.timestamp)}</td>
                    <td class="px-6 py-3">${compra.userName}</td>
                    <td class="px-6 py-3 font-medium text-indigo-800">${compra.itemName}</td>
                    <td class="px-6 py-3 text-right font-bold text-red-600">-${AppFormat.formatBalance(compra.cost)}</td>
                    <td class="px-6 py-3 text-xs text-gray-500">${compra.adminId}</td>
                </tr>
             `;
         });
         comprasLogsBody.innerHTML = htmlCompras;
    },
    
    /**
     * Renderiza la vista de Compras para el usuario.
     */
    renderUserTienda: function() {
        const userTiendaContainer = document.getElementById('tienda-items-container');
        const statusMsgEl = document.getElementById('tienda-user-status-message');
        
        AppUI.clearStatus(statusMsgEl);
        
        const itemsActivos = AppState.tiendaItems.filter(i => i.isActive);
        
        if (itemsActivos.length === 0) {
            userTiendaContainer.innerHTML = '<p class="text-center text-gray-500 py-8">No hay ítems activos en la tienda en este momento.</p>';
            return;
        }

        let html = '';
        itemsActivos.sort((a, b) => a.cost - b.cost); // Ordenar por costo

        itemsActivos.forEach(item => {
            const isSoldOut = item.stock === 0;
            const stockDisplay = item.stock !== -1 
                ? `<p class="text-xs ${isSoldOut ? 'text-red-500' : 'text-gray-500'}">Stock: ${AppFormat.formatStock(item.stock)}</p>` 
                : '<p class="text-xs text-green-500">Stock: Ilimitado</p>';
            
            const buttonHtml = isSoldOut 
                ? `<button disabled class="w-full py-2 bg-gray-400 text-white font-semibold rounded-full cursor-not-allowed">Agotado</button>`
                : `<button onclick="AppUI.handleConfirmCompra('${item.id}', '${item.name}', ${item.cost})" 
                          class="w-full py-2 bg-indigo-600 text-white font-semibold rounded-full hover:bg-indigo-700 transition duration-150">
                            Comprar
                        </button>`;

            html += `
                <div class="bg-white p-5 rounded-xl shadow-lg flex flex-col justify-between border-2 hover:border-indigo-400 transition duration-150">
                    <div>
                        <h3 class="text-xl font-bold text-gray-900 mb-1">${item.name}</h3>
                        <p class="text-sm text-gray-600 h-12 overflow-hidden mb-3">${item.description}</p>
                    </div>
                    <div>
                        <p class="text-3xl font-extrabold text-red-600 my-3">-${AppFormat.formatBalance(item.cost)} Pinceladas</p>
                        ${stockDisplay}
                        <div class="mt-4">
                            ${buttonHtml}
                        </div>
                    </div>
                </div>
            `;
        });
        userTiendaContainer.innerHTML = html;
    },

    /**
     * Renderiza el dropdown de usuarios.
     * @param {string} selectId - ID del elemento select.
     * @param {Array<Object>} users - Lista de usuarios.
     */
    renderUserDropdown: function(selectId, users = AppState.users) {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return;

        let html = '<option value="" disabled selected>Selecciona un usuario...</option>';
        
        // Ordenar por nombre
        const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));
        
        sortedUsers.forEach(user => {
            html += `<option value="${user.id}">${user.name} (${AppFormat.formatBalance(user.balance)})</option>`;
        });
        
        selectEl.innerHTML = html;
    },
    
    /**
     * Renderiza la lista de checkboxes para transacción múltiple.
     */
    renderMultipleUserList: function() {
        const listContainer = document.getElementById('multiple-user-list');
        if (!listContainer) return;
        
        let html = '';
        AppState.users.forEach(user => {
            html += `
                <div class="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg">
                    <input id="user-${user.id}" type="checkbox" value="${user.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                    <label for="user-${user.id}" class="text-sm text-gray-900 cursor-pointer">
                        ${user.name} <span class="text-xs text-gray-500">(${AppFormat.formatBalance(user.balance)})</span>
                    </label>
                </div>
            `;
        });
        
        listContainer.innerHTML = html;
    },

    // --- MANEJADORES DE EVENTOS ---
    
    /**
     * Maneja la selección de un usuario en el Dashboard.
     * @param {string} userId - ID del usuario.
     * @param {string} userName - Nombre del usuario.
     */
    handleSelectUser: function(userId, userName) {
        if (AppState.selectedUserId === userId) {
            AppState.selectedUserId = null;
            AppState.selectedUserName = '';
            this.navigate('dashboard');
        } else {
            AppState.selectedUserId = userId;
            AppState.selectedUserName = userName;
            this.navigate('transacciones-wrapper');
        }
        this.renderDashboard(); // Refrescar la tabla para el estilo de selección
    },

    /**
     * Maneja la apertura del modal de edición de Bono.
     * @param {string} [bonoId] - ID del bono para editar.
     */
    handleEditBono: function(bonoId) {
        const modalTitle = document.getElementById('gestion-bono-modal-title');
        const form = document.getElementById('gestion-bono-form');
        const docIdInput = document.getElementById('bono-doc-id');
        const isActiveInput = document.getElementById('bono-is-active');

        form.reset();
        docIdInput.value = '';
        isActiveInput.checked = true;
        
        if (bonoId) {
            const bono = AppState.bonos.find(b => b.id === bonoId);
            if (!bono) {
                this.showNotification("Error: Bono no encontrado.", 'error');
                return;
            }
            modalTitle.textContent = `Editar Bono: ${bono.name}`;
            docIdInput.value = bono.id;
            document.getElementById('bono-name').value = bono.name;
            document.getElementById('bono-cost').value = bono.cost;
            document.getElementById('bono-type').value = bono.type;
            document.getElementById('bono-code').value = bono.code;
            isActiveInput.checked = bono.isActive;
        } else {
            modalTitle.textContent = "Crear Nuevo Bono";
        }
        
        this.showModal('gestion-bono-modal');
    },

    /**
     * Maneja el submit del formulario de gestión de bonos.
     */
    handleSubmitBono: function() {
        const form = document.getElementById('gestion-bono-form');
        const bonoData = {
            docId: document.getElementById('bono-doc-id').value,
            name: document.getElementById('bono-name').value.trim(),
            cost: document.getElementById('bono-cost').value,
            type: document.getElementById('bono-type').value.trim(),
            code: document.getElementById('bono-code').value.trim(),
            isActive: document.getElementById('bono-is-active').checked
        };

        if (!bonoData.name || !bonoData.cost || !bonoData.type || !bonoData.code) {
             this.showNotification("Todos los campos son obligatorios.", 'error');
             return;
        }
        
        if (isNaN(parseInt(bonoData.cost)) || parseInt(bonoData.cost) <= 0) {
            this.showNotification("El costo debe ser un número positivo.", 'error');
            return;
        }

        AppTransacciones.crearOActualizarBono(bonoData);
    },
    
    /**
     * Maneja la apertura del modal de edición de Item de Tienda.
     * @param {string} [itemId] - ID del item para editar.
     */
    handleEditItem: function(itemId) {
        const modalTitle = document.getElementById('gestion-item-modal-title');
        const form = document.getElementById('gestion-item-form');
        const docIdInput = document.getElementById('item-doc-id');
        const isActiveInput = document.getElementById('item-is-active');

        form.reset();
        docIdInput.value = '';
        isActiveInput.checked = true;
        
        if (itemId) {
            const item = AppState.tiendaItems.find(i => i.id === itemId);
            if (!item) {
                this.showNotification("Error: Item no encontrado.", 'error');
                return;
            }
            modalTitle.textContent = `Editar Item: ${item.name}`;
            docIdInput.value = item.id;
            document.getElementById('item-name').value = item.name;
            document.getElementById('item-cost').value = item.cost;
            document.getElementById('item-description').value = item.description;
            document.getElementById('item-stock').value = item.stock;
            isActiveInput.checked = item.isActive;
        } else {
            modalTitle.textContent = "Crear Nuevo Item de Tienda";
        }
        
        this.showModal('gestion-item-modal');
    },

    /**
     * Maneja el submit del formulario de gestión de items de tienda.
     */
    handleSubmitItem: function() {
        const form = document.getElementById('gestion-item-form');
        const itemData = {
            docId: document.getElementById('item-doc-id').value,
            name: document.getElementById('item-name').value.trim(),
            cost: document.getElementById('item-cost').value,
            description: document.getElementById('item-description').value.trim(),
            stock: document.getElementById('item-stock').value,
            isActive: document.getElementById('item-is-active').checked
        };

        if (!itemData.name || !itemData.cost || !itemData.description || itemData.stock === undefined || itemData.stock === null || itemData.stock === '') {
             this.showNotification("Todos los campos son obligatorios.", 'error');
             return;
        }
        
        if (isNaN(parseInt(itemData.cost)) || parseInt(itemData.cost) <= 0) {
            this.showNotification("El costo debe ser un número positivo.", 'error');
            return;
        }
        
        if (isNaN(parseInt(itemData.stock))) {
            this.showNotification("El stock debe ser un número entero (o -1 para ilimitado).", 'error');
            return;
        }

        AppTransacciones.crearOActualizarItem(itemData);
    },

    /**
     * Muestra el modal de confirmación de eliminación.
     * @param {'bono'|'item'} type - Tipo de elemento a eliminar.
     * @param {string} docId - ID del documento.
     * @param {string} name - Nombre del elemento.
     */
    handleDeleteConfirmation: function(type, docId, name) {
        let title, body, onConfirm;

        if (type === 'bono') {
            title = "Confirmar Eliminación de Bono";
            body = `¿Estás seguro de que quieres eliminar permanentemente el bono **${name}**? Esta acción es irreversible.`;
            onConfirm = () => AppTransacciones.eliminarBono(docId);
        } else if (type === 'item') {
            title = "Confirmar Eliminación de Item";
            body = `¿Estás seguro de que quieres eliminar permanentemente el ítem de la tienda **${name}**? Esta acción es irreversible.`;
            onConfirm = () => AppTransacciones.eliminarItem(docId);
        } else {
            return;
        }
        
        this.showCustomModal({ title, body, onConfirm });
    },
    
    /**
     * Maneja la apertura del modal de confirmación de compra.
     * @param {string} itemId - ID del item.
     * @param {string} itemName - Nombre del item.
     * @param {number} itemCost - Costo del item.
     */
    handleConfirmCompra: function(itemId, itemName, itemCost) {
        const item = AppState.tiendaItems.find(i => i.id === itemId);
        if (!item) return this.showNotification('Ítem no encontrado.', 'error');

        // Determinar el usuario que compra (Admin en modo manual, o el usuario en modo automático)
        let userIdToCharge;
        let userNameToCharge;

        if (AppState.isAdmin && AppState.isStoreManual) {
            // Modo manual: El Admin selecciona el usuario a cargar
            this.showModal('tienda-confirm-modal');
            document.getElementById('tienda-confirm-title').textContent = `Confirmar Compra: ${itemName}`;
            document.getElementById('tienda-confirm-cost').textContent = `Costo: -${AppFormat.formatBalance(itemCost)} Pinceladas`;
            document.getElementById('tienda-confirm-itemId').value = itemId;
            
            this.renderUserDropdown('tienda-confirm-user', AppState.users);
            
            // Si el Admin confirma, la lógica de compra se maneja en handleSubmitConfirmCompra
        } else {
            // Modo automático: La compra se carga al Admin logueado (si es admin) o falla si no es Admin.
            // En un app real, esto sería el usuario final, pero aquí asumimos el Admin es el único logueado
            // Y si no es Admin, asumimos que no debería estar aquí, pero forzaremos un fallo si no hay usuarios.
            
            if (!AppState.isAdmin) {
                 this.showNotification("Funcionalidad de compra para usuarios no habilitada en esta versión.", 'error');
                 return;
            }
            
            // Admin logueado en modo automático
            userIdToCharge = AppState.userId;
            userNameToCharge = 'Admin'; 
            
            this.showCustomModal({
                title: `Confirmar Compra Automática`,
                body: `¿Estás seguro de que quieres registrar la compra de **${itemName}** (${AppFormat.formatBalance(itemCost)} Pinceladas) para el usuario **${userNameToCharge}**?`,
                onConfirm: () => AppTransacciones.comprarItem(userIdToCharge, item)
            });
        }
    },
    
    /**
     * Maneja el submit del modal de confirmación de compra (Modo Manual).
     */
    handleSubmitConfirmCompra: function() {
        const userId = document.getElementById('tienda-confirm-user').value;
        const itemId = document.getElementById('tienda-confirm-itemId').value;
        const statusMsgEl = document.getElementById('tienda-confirm-status-message');
        
        AppUI.clearStatus(statusMsgEl);
        
        if (!userId) {
            return AppUI.setError(statusMsgEl, "Debes seleccionar un usuario.");
        }
        
        const item = AppState.tiendaItems.find(i => i.id === itemId);
        if (!item) return AppUI.setError(statusMsgEl, "Ítem no válido.");
        
        AppTransacciones.comprarItem(userId, item);
    },


    // --- AUTENTICACIÓN Y ESTADO DE LA APLICACIÓN ---

    /**
     * Maneja el intento de login con clave maestra.
     */
    handleMasterKeyLogin: async function() {
        const key = document.getElementById('master-key-input').value.trim();
        const statusMsgEl = document.getElementById('auth-status-message');
        
        AppUI.clearStatus(statusMsgEl);

        if (key === AppConfig.CLAVE_MAESTRA) {
            AppUI.showLoading("Verificando clave maestra...");
            try {
                // Actualizar Firestore para registrar este usuario como Admin
                if (AppState.userId) {
                    const privateDocRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).userPrivate, 'settings');
                    await setDoc(privateDocRef, { isAdmin: true, isStoreManual: AppState.isStoreManual || false }, { merge: true });
                    
                    AppState.isAdmin = true;
                    this.updateUIVisibility();
                    this.setSuccess(statusMsgEl, "Acceso de Admin concedido. Redirigiendo...");
                    this.navigate('dashboard');
                } else {
                    this.setError(statusMsgEl, "No se pudo obtener la ID de usuario. Intenta recargar.");
                }
            } catch (e) {
                console.error("Error al establecer admin status:", e);
                this.setError(statusMsgEl, "Fallo en la comunicación con la base de datos.");
            } finally {
                 AppUI.hideLoading();
                 document.getElementById('login-modal').classList.add('hidden');
            }

        } else {
            document.getElementById('master-key-input').classList.add('shake');
            setTimeout(() => document.getElementById('master-key-input').classList.remove('shake'), 500);
            this.setError(statusMsgEl, "Clave maestra incorrecta.");
        }
    },
    
    /**
     * Muestra el modal de Login (Clave Maestra).
     */
    handleOpenLoginModal: function() {
        document.getElementById('login-modal').classList.remove('hidden');
        document.getElementById('master-key-input').focus();
    },
    
    /**
     * Maneja el cierre de sesión (solo para Admin).
     */
    handleLogout: async function() {
        AppUI.showLoading("Cerrando sesión...");
        try {
            if (AppState.auth) {
                // Quitar el rol de Admin en la base de datos
                if (AppState.userId) {
                    const privateDocRef = doc(AppState.db, AppConfig.getCollections(AppState.userId).userPrivate, 'settings');
                    await setDoc(privateDocRef, { isAdmin: false }, { merge: true });
                }
                
                // Cerrar sesión en Firebase
                await AppState.auth.signOut(); 
                
                AppState.isAdmin = false;
                this.updateUIVisibility();
                AppUI.showNotification("Sesión de administrador cerrada.");
            }
        } catch (e) {
            console.error("Error al cerrar sesión:", e);
            AppUI.showNotification("Error al cerrar sesión.", 'error');
        } finally {
            AppUI.hideLoading();
            this.navigate('login-container');
        }
    },

    /**
     * Muestra el estado y versión de la aplicación.
     */
    updateAppStatus: function() {
        const versionText = `Versión: ${AppConfig.APP_VERSION}`;
        const statusText = `ID: ${AppState.userId ? AppState.userId.substring(0, 8) + '...' : 'Anon'}`;

        document.getElementById('app-version').textContent = versionText;
        document.getElementById('app-status').textContent = statusText;
        document.getElementById('app-version-mobile').textContent = versionText;
        document.getElementById('app-status-mobile').textContent = statusText;
        document.getElementById('app-id-display').textContent = AppState.userId || 'Sin ID';
    }
};


// --- INICIALIZACIÓN --
window.AppUI = AppUI;
window.AppFormat = AppFormat;
window.AppTransacciones = AppTransacciones;

// Exponer funciones necesarias al scope global para onclick="" en HTML
window.AppUI.handleEditBono = AppUI.handleEditBono;
window.AppUI.handleSubmitBono = AppUI.handleSubmitBono;
window.AppTransacciones.eliminarBono = AppTransacciones.eliminarBono;
window.AppUI.handleEditItem = AppUI.handleEditItem;
window.AppUI.handleSubmitItem = AppUI.handleSubmitItem;
window.AppTransacciones.eliminarItem = AppTransacciones.eliminarItem;
window.AppUI.handleDeleteConfirmation = AppUI.handleDeleteConfirmation;
window.AppUI.handleOpenLoginModal = AppUI.handleOpenLoginModal;
window.AppUI.handleMasterKeyLogin = AppUI.handleMasterKeyLogin;
window.AppUI.handleLogout = AppUI.handleLogout;
window.AppUI.handleSelectUser = AppUI.handleSelectUser;
window.AppTransacciones.procesarTransaccionUnitaria = AppTransacciones.procesarTransaccionUnitaria;
window.AppTransacciones.procesarTransferenciaP2P = AppTransacciones.procesarTransferenciaP2P;
window.AppTransacciones.procesarTransaccionMultiple = AppTransacciones.procesarTransaccionMultiple;
window.AppTransacciones.canjearBono = AppTransacciones.canjearBono;
window.AppUI.handleConfirmCompra = AppUI.handleConfirmCompra;
window.AppUI.handleSubmitConfirmCompra = AppUI.handleSubmitConfirmCompra;
window.AppTransacciones.toggleStoreManual = AppTransacciones.toggleStoreManual;
window.AppTransacciones.registrarNuevoUsuario = AppTransacciones.registrarNuevoUsuario;


// --- INICIO DE LA APLICACIÓN ---
window.onload = function() {
    initializeFirebase();
    // Navegar a la vista de login o al dashboard (la autenticación se encarga de esto)
    AppUI.navigate('login-container'); 
    
    // Asignar event listeners a los botones de navegación una vez que el DOM esté cargado
    document.querySelectorAll('[data-view]').forEach(button => {
        button.addEventListener('click', (e) => {
            const view = e.currentTarget.getAttribute('data-view');
            AppUI.navigate(view);
        });
    });
    
    // Asignar listeners a los botones de administración fuera de la barra de navegación
    document.getElementById('open-gestion-modal').addEventListener('click', AppUI.handleLogout);
    
    // Listener para canje de bono (para el formulario rápido)
    document.getElementById('canjear-bono-btn').addEventListener('click', (e) => {
        e.preventDefault();
        const userId = document.getElementById('canjear-bono-user').value;
        const code = document.getElementById('canjear-bono-code').value.trim();
        if (userId && code) {
             AppTransacciones.canjearBono(userId, code);
        } else {
             AppUI.showNotification("Selecciona un usuario e ingresa el código.", 'error');
        }
    });
};
