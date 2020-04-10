import AccessControl from "./AccessControl";
import SocketIO from "socket.io";
import User from "./User";
import { v4 as uuidv4 } from "uuid";

export default class Room {
    private _access: AccessControl;
    private _password: string | null = null;
    private _key: string;
    private _users: { [k: string]: User } = {};
    private _identMap: { [k: string]: string } = {};
    private _data: any = {};
    private _oneTimePass: string[] = [];
    private _onDeleteHooks: Array<(room: Room) => void> = [];
    private _onSaveHooks: Array<(room: Room) => void> = [];
    private _closeTimeout: NodeJS.Timeout | null = null;
    private _maxBytes: number = 0;

    public static Factory(key: string, config: null | { [k: string]: any } = null) {
        return new Room(key, config);
    }

    private constructor(key: string, config: null | { [k: string]: any } = null) {
        this._key = key;
        this._access = new AccessControl();
        config = config || {};
        this._maxBytes = config.maxBytes || this._maxBytes;
    }

    public onDelete(cb: (room: Room) => void) {
        this._onDeleteHooks.push(cb);
        return this;
    }

    public onSave(cb: (room: Room) => void) {
        this._onSaveHooks.push(cb);
        return this;
    }

    get key() {
        return this._key;
    }

    public setPassword(password: string | null, user: User) {
        if (this.access.canAdmin(user)) {
            this._password = JSON.parse(JSON.stringify(password));
        }
    }

    public load(data: { [k: string]: any }) {
        console.log(`[${this._key}][Loding...]:`, data);
        this._password = data.password || null;
        this._access = new AccessControl(data.access || {});
        this._identMap = data.identMap || {};
        this._data = data.data || {};
        return this;
    }

    public getSave() {
        return {
            password: this._password,
            access: this.access.getSave(),
            identMap: this._identMap,
            data: this._data,
        };
    }

    private passwordCheck(password: string): boolean {
        if (this._password === null) {
            return true;
        }
        return this._password === password || this.oneTimePasswordCheck(password);
    }

    private oneTimePasswordCheck(password: string) {
        const index = this._oneTimePass.indexOf(password);
        if (index >= 0) {
            this._oneTimePass.splice(index, 1);
            return true;
        }
        return false;
    }

    private joinCheck(user: User, password: string): boolean {
        if (this.access.canJoin(user)) {
            return true;
        }
        return this.passwordCheck(password);
    }

    public join(socket: SocketIO.Socket, password: string): boolean {
        const user = new User(socket, this.key);
        this.access.attemptClaim(user.ident);
        this.removeOldUser(user);
        if (this.joinCheck(user, password)) {
            console.log(`[${this._key}][User Joined] : ${user.name}`);
            this._users[user.ident] = user;
            if (!this._identMap.hasOwnProperty(user.ident)) {
                this._identMap[user.ident] = uuidv4();
            }
            this.access.addRead(user);
            this.userHooks(user);
            user.sendData(this._data);
            user.sendOwnUser(this.getUserData(user));
            this.sendUsersToUsers();
            user.emit("joinRoom", this.key);
            this.save();
            return true;
        }
        user.emit("passwordFailed", this._key);
        console.log(`[${this._key}][User Rejected] : ${user.name} - ${password}`);
        return false;
    }

    private removeOldUser(user: User) {
        if (this._users.hasOwnProperty(user.ident)) {
            this._users[user.ident].disconnect();
        }
    }

    private userHooks(user: User) {
        user
            .onSocket("setData", data => this.setData(data, user))
            .onSocket("removeData", keys => this.removeData(keys, user))
            .onSocket("grantUser", userRank => this.grantUser(userRank, user))
            .onSocket("setPassword", password => this.setPassword(password, user))
            .onSocket("getOneTimePass", () => this.generateOneTimePass(user))
            .onSocket("relay", data => this.relay(data, user))
            .onSocket("debug", () => this.debug(user))
            // .onSocket("leave", () => this.leave(user))
            .onUpdate(user => this.userUpdate(user))
            .onDisconnect(user => this.userDisconnect(user));
    }

    // private leave(user: User) {
    //     if (this._users.hasOwnProperty(user.ident)) {
    //         this._users[user.ident];
    //     }
    // }

    private debug(user: User) {
        if (this.access.canAdmin(user)) {
            const data = this.getSave();
            user.emit("debug", { ...data, users: this.getUsersData() });
        }
    }

    private relay(data: any, sender: User) {
        Object.values(this._users)
            .forEach(user => user.relay(this._identMap[sender.ident], data));
    }

    private generateOneTimePass(user: User) {
        if (this.access.canAdmin(user)) {
            const oneTime = uuidv4();
            this._oneTimePass.push(oneTime);
            user.sendOneTimePass(oneTime);
        }
    }

    private grantUser(userRank: { ident: string, rank: string }, user: User) {
        console.log(`[${this.key}][Grant User]: ${user.name} wants to give ` + JSON.stringify(userRank));
        const { ident: maskedIdent, rank } = userRank;
        const ident = this._identMap[maskedIdent] || null;
        if (this.access.canAdmin(user) && ident !== null) {
            const userGrant = this._users[ident];
            if (!this.access.canAdmin(userGrant) || this.access.isOwner(user)) {
                if (userGrant.ident !== user.ident) {
                    switch (rank.toLowerCase()) {
                        case "admin":
                            this.access.addAdmin(userGrant, user);
                            break;
                        case "write":
                            this.access.remAdmin(userGrant.ident, user);
                            this.access.addWrite(userGrant, user);
                            break;
                        case "join":
                            this.access.remAdmin(userGrant.ident, user);
                            this.access.remWrite(userGrant.ident, user);
                            this.access.addRead(userGrant);
                            break;
                    }
                    this.sendUsersToUsers();
                    this.save();
                }
            }
        }
    }

    private userUpdate(user: User) {
        user.sendOwnUser(this.getUserData(user));
        this.sendUsersToUsers();
    }

    private userDisconnect(user: User) {
        console.log(`[${this._key}][User Left] : ${user.name}`);
        delete this._users[user.ident];
        delete this._identMap[user.ident];
        this.sendUsersToUsers();
        if (this._closeTimeout !== null) {
            clearTimeout(this._closeTimeout);
            this._closeTimeout = null;
        }
        this._closeTimeout = setTimeout(() => {
            this._closeTimeout = null;
            if (Object.values(this._users).length < 1) {
                this.delete();
            }
        }, 10000);
    }

    private removeData(keys: string[], user: User) {
        keys = JSON.parse(JSON.stringify(keys));
        if (this.access.canWrite(user) && keys instanceof Array) {
            const current = JSON.parse(JSON.stringify(this._data));
            for (const key of keys) {
                if (current.hasOwnProperty(key)) {
                    delete current[key];
                }
            }
            if (this.validateData(current)) {
                this._data = current;
                this.sendRemovalsToUsers(keys);
                this.save();
                return;
            }
        }
        user.sendData(this._data);
    }

    private setData(data: any, user: User) {
        if (this.access.canWrite(user)) {
            data = JSON.parse(JSON.stringify(data));
            if (typeof data === "object" && data !== null && !(data instanceof Array)) {
                const current = JSON.parse(JSON.stringify(this._data));
                for (const key in data) {
                    current[key] = data[key];
                }
                if (this.validateData(current)) {
                    this._data = current;
                    this.sendDataToUsers(data);
                    this.save();
                    return;
                }
            }
        }
        user.sendData(this._data);
    }

    private validateData(data: any) {
        // TODO : validate data via schema;
        const bytes = (new TextEncoder().encode(JSON.stringify(JSON.stringify(data)))).length;
        return typeof data === "object" && data !== null && (bytes <= this._maxBytes || this._maxBytes < 1);
    }

    private sendRemovalsToUsers(keys: string[]) {
        Object.values(this._users)
            .forEach(user => user.sendRemovals(keys));
    }

    private sendDataToUsers(data: { [k: string]: any }) {
        Object.values(this._users)
            .forEach(user => user.sendData(data));
    }

    private sendUsersToUsers() {
        const users = this.getUsersData();
        Object.values(this._users)
            .forEach(user => user.sendUsers(users));
    }

    public getUsersData() {
        const users: { [k: string]: {} } = {};
        Object.values(this._users).forEach(user => {
            users[this._identMap[user.ident]] = this.getUserData(user);
        });
        return users;
    }

    private getUserData(user: User) {
        return {
            name: user.name,
            write: this.access.canWrite(user),
            admin: this.access.canAdmin(user),
            owner: this.access.isOwner(user),
            ident: this._identMap[user.ident],
        };
    }

    get access() {
        return this._access;
    }

    private save() {
        this._onSaveHooks.forEach(cb => cb(this));
    }

    private delete() {
        this._onDeleteHooks.forEach(cb => cb(this));
    }
}