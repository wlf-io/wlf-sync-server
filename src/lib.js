"use strict";
(function (env) {
    const typeofCompare = (a, b) => {
        const aType = typeof a;
        if (aType !== typeof b) return false;
        switch (aType) {
            case "string":
            case "boolean":
            case "number":
            case "bigint":
                if (a !== b) return false;
                break;
            case "function":
                if (a.toString() !== b.toString()) return false;
                break;
            case "object":
                if (!simpleObjCompare(a, b)) return false;
                break;
            case "undefined":
            default:
                return true;
        }
    }
    const simpleObjCompare = (a, b) => {
        if (typeof a !== typeof b) return false;

        if ((a === null || b === null) && a !== b) return false;

        if ((a instanceof Date && b instanceof Date) ||
            (a instanceof RegExp && b instanceof RegExp) ||
            (a instanceof String && b instanceof String) ||
            (a instanceof Number && b instanceof Number)) {
            return a.toString() === b.toString();
        }

        if (a instanceof Array && b instanceof Array) {
            if (a.length !== b.length) return false;
            for (const i in a) {
                if (!typeofCompare(a[i], b[i])) return false;
            }
        } else {
            const aKeys = Object.keys(a);
            const bKeys = Object.keys(b);
            if (aKeys.length !== bKeys.length) return false;
            aKeys.sort();
            bKeys.sort();
            if (a.join("|") !== b.join("|")) return false;
            for (const key of aKeys) {
                if (!typeofCompare(a[key], b[key])) return false;
            }
        }
        return true;
    }

    const CreateSocket = (sock) => {
        switch (typeof sock) {
            case "string":
                return io(sock);
            case "object":
                return sock;
            default:
                return io();
        }
    };

    const checkSimpleObject = (obj, name = "Argument") => {
        if (typeof obj !== "object" || obj === null || obj instanceof Array) {
            throw { error: name + " must be a simple js object" };
        }
    }

    const cleanObj = obj => JSON.parse(JSON.stringify(obj));

    const HOOK_SET_DATA = "setData";
    const HOOK_RELAY = "relay";
    const HOOK_REMOVE_DATA = "removeData";
    const HOOK_CONNECT = "connect";
    const HOOK_DISCONNECT = "disconnect";
    const HOOK_DEBUG = "debug";
    const HOOK_SET_USERS = "setUsers";
    const HOOK_YOUR_USER = "yourUser";
    const HOOK_NEW_USER = "newUser";
    const HOOK_USER_CHANGED = "userChanged";
    const HOOK_USER_LEFT = "userLeft";
    const HOOK_JOIN_ROOM = "joinRoom";
    const HOOK_PASSWORD_FAILED = "passwordFailed";

    function WlfSync(address) {
        if (typeof address === "string") {
            this.address = address;
        }
        const data = {};
        const users = {};
        const user = null;
        const _hooks = {};

        const triggerHook = (hook, key, data) => {
            if (key instanceof Array) {
                data = key;
                key = "all";
            }
            if (!(data instanceof Array)) {
                data = [data];
            }
            const hookSet = _hooks[hook] || {};
            const hooks = hookSet[key] || [];
            hooks.foreach(h => h(...data));
            if (key !== "all") {
                triggerHook(hook, "all", data);
            }
        }

        const roomName = null;

        this.getData = (key) => (typeof key === "string") ? data[key] : { ...data };
        this.getUsers = (key) => (typeof key === "string") ? users[key] : { ...users };
        this.getRoom = () => roomName;


        let socket = null;

        const socketSetData = evt => {
            const { room, data: newData } = evt;
            for (const key in newData) {
                triggerHook(HOOK_SET_DATA, key, [key, newData[key], data[key]]);
                data[key] = newData[key];
            }
        };

        const socketRemoveData = evt => {
            const { room, data: keys } = evt;
            for (const key of keys) {
                if (data.hasOwnProperty(key)) {
                    triggerHook(HOOK_REMOVE_DATA, key, [key, data[key]]);
                    delete data[key];
                }
            }
        };

        const socketSetUsers = evt => {
            const { room, data: newUsers } = evt;
            const _newUsers = cleanObj(newUsers);
            const currentUsers = cleanObj(users);
            for (const key in newUsers) {
                const newUser = { ...newUsers[key] };
                if (currentUsers.hasOwnProperty(key)) {
                    const currentUser = { ...currentUsers[key] };
                    if (!simpleObjCompare(currentUser, newUser)) {
                        triggerHook(HOOK_USER_CHANGED, key, [key, newUser, currentUser]);
                    }
                } else {
                    triggerHook(HOOK_NEW_USER, [key, newUser]);
                }
            }

            for (const key in currentUsers) {
                if (!newUsers.hasOwnProperty(key)) {
                    const currentUser = { ...currentUsers[key] };
                    triggerHook(HOOK_USER_LEFT, key, [key, currentUser]);
                }
            }

            triggerHook(HOOK_SET_USERS, { ...newUsers }, currentUsers);
            users = _newUsers;
        };

        const socketSetYourUser = evt => {
            const { room, data: newUser } = evt;
            triggerHook(HOOK_YOUR_USER, [newUser.ident, cleanObj(newUser), user]);
            user = newUser;
        };

        const connected = () => {
            triggerHook(HOOK_CONNECT);
            connectPromise.resolve();
        };

        const socketEmit = (event, data) => {
            if (socket === null) {
                throw { error: "Socket not created try calling '.connect()' first" };
            }
            if (!socket.connected) {
                throw { error: "Socket not connected" };
            }
            socket.emit(event, data);
        }

        const socketJoinRoom = event => {
            if (event.data === event.room) {
                roomName = event.data;
            }
            triggerHook(HOOK_JOIN_ROOM, room, [room]);
            joinRoomPromise.resolve(roomName);
        }

        const socketPasswordFailed = () => {
            joinRoomPromise.reject();
            triggerHook(HOOK_PASSWORD_FAILED, []);
        };

        const hookSocket = () => {
            socket.on(HOOK_SET_DATA, evt => socketSetData(evt));
            socket.on(HOOK_REMOVE_DATA, evt => socketRemoveData(evt));
            socket.on(HOOK_RELAY, evt => triggerHook(HOOK_RELAY, [evt.data]));
            socket.on(HOOK_CONNECT, evt => connected());
            socket.on(HOOK_DISCONNECT, evt => triggerHook(HOOK_DISCONNECT));
            socket.on(HOOK_DEBUG, evt => triggerHook(HOOK_DEBUG, [evt.data]));
            socket.on(HOOK_SET_USERS, evt => socketSetUsers(evt));
            socket.on(HOOK_YOUR_USER, evt => socketSetYourUser(evt));
            socket.on(HOOK_JOIN_ROOM, evt => socketJoinRoom(evt));
            socket.on(HOOK_PASSWORD_FAILED, () => socketPasswordFailed());
        };

        let connectPromise = null;
        let joinRoomPromise = null;

        this.connect = () => {
            return new Promise((res, rej) => {
                connectPromise = { resolve: res, reject: rej };
                socket = io(this.address);
                hookSocket();
            });
        };

        this.joinRoom = (room, pass) => {
            if (typeof room !== "string") {
                throw { error: "room must be string" };
            }
            if (typeof room !== "string" && room !== null) {
                throw { error: "pass must be a string or null" };
            }
            return new Promise((res, rej) => {
                joinRoomPromise = { resolve: res, reject: rej };
                socketEmit(HOOK_JOIN_ROOM, { room: room, pass: pass });
            });
        };

        this.setValue = (key, value) => this.setData({ [key]: value });

        this.setData = data => {
            data = cleanObj(data);
            checkSimpleObject(data, "data");
            socketEmit(HOOK_SET_DATA, data);
        };

        this.setUser = user => {
            user = cleanObj(user);
            checkSimpleObject(user, "user");
            socketEmit(HOOK_YOUR_USER, user);
        }

        this.relay = data => {
            data = cleanObj(data);
            checkSimpleObject(data)
        }



        this.on = (event, key, cb) => {
            if (typeof key === "function") {
                cb = key;
                key = "all";
            }
            const hooks = _hooks[event] || {};
            hooks[key] = [cb, ...(hooks[key] || [])];
            _hooks[event] = hooks;
            return this;
        };
    }

    WlfSync.prototype = {
        address: "/",
        _eventHooks: {},
        onSetData: (key, cb) => this.on(HOOK_SET_DATA, key, cb),
        onRemoveData: (key, cb) => this.on(HOOK_REMOVE_DATA, key, cb),
        onRelay: cb => this.on(HOOK_RELAY, cb),
        onConnect: cb => this.on(HOOK_CONNECT, cb),
        onDisconnect: cb => this.on(HOOK_DISCONNECT, cb),
        onDebug: cb => this.on(HOOK_DEBUG, cb),
        onSetUsers: cb => this.on(HOOK_SET_USERS, cb),
        onYourUser: cb => this.on(HOOK_YOUR_USER, cb),
        onNewUser: cb => this.on(HOOK_NEW_USER, cb),
        onUserChange: (key, cb) => this.on(HOOK_USER_CHANGED, key, cb),
        onUserLeft: (key, cb) => this.on(HOOK_USER_LEFT, key, cb),
        debug: () => console.log("RUN", this.address, this.getData()),
    };

    WlfSync.HOOK_REMOVE_DATA = HOOK_REMOVE_DATA;
    WlfSync.HOOK_SET_DATA = HOOK_SET_DATA;
    WlfSync.HOOK_RELAY = HOOK_RELAY;

    const register = (env, error) => {
        if (!env.hasOwnProperty("io")) {
            if (error) {
                console.error('WlfSync requires socket.io to be loaded\n\nYou can do this using <script src="/socket.io/socket.io.js"></script> in the header');
            }
        } else if (!env.hasOwnProperty(WlfSync)) {
            env.WlfSync = WlfSync;
        }
    }

    register(env, false);

    document.addEventListener('DOMContentLoaded', () => register(env, true));

})(this);