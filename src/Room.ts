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

    public static Factory(key: string) {
        return new Room(key);
    }

    private constructor(key: string) {
        this._key = key;
        this._access = new AccessControl();
        this._password = "CAKE";
    }

    get key() {
        return this._key;
    }

    public load(data: { [k: string]: any }) {
        console.log(`[${this._key}][Loding...]:` + JSON.stringify(data));
        this._password = data.password || "CAKE";
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

    public join(socket: SocketIO.Socket, password: string) {
        const user = new User(socket, this.key);
        this.access.attemptClaim(user.ident);
        if (this.joinCheck(user, password)) {
            console.log(`[${this._key}][User Joined] : ${user.name}`);
            this._users[user.ident] = user;
            if (!this._identMap.hasOwnProperty(user.ident)) {
                this._identMap[user.ident] = uuidv4();
            }
            this.access.addRead(user);
            this.userHooks(user);
            user.sendData(this._data);
            this.sendUsersToUsers();
            return true;
        }
        console.log(`[${this._key}][User Rejected] : ${user.name} - ${password}`);
        return false;
    }

    private userHooks(user: User) {
        user.onSocket("setData", data => this.setData(data, user));
        user.onSocket("setDataPart", dataPart => this.setDataPart(dataPart, user));
        user.onSocket("grantUser", userRank => this.grantUser(userRank, user));
        user.onSocket("getOneTimePass", () => this.generateOneTimePass(user));
        user.onUpdate(user => this.userUpdate(user));
        user.onDisconnect(user => this.userDisconnect(user));
    }

    private generateOneTimePass(user: User) {
        if (this.access.canAdmin(user)) {
            const oneTime = uuidv4();
            this._oneTimePass.push(oneTime);
            user.sendOneTimePass(oneTime);
        }
    }

    private grantUser(userRank: { maskedIdent: string, rank: string }, user: User) {
        const { maskedIdent, rank } = userRank;
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
                }
            }
        }
    }

    private userUpdate(user: User) {
        user.sendOwnUser(this.getUserData(user));
        this.sendUsersToUsers();
    }

    private userDisconnect(user: User) {
        delete this._users[user.ident];
        delete this._identMap[user.ident];
        this.sendUsersToUsers();
    }

    private setData(data: any, user: User) {
        if (this.access.canWrite(user) && this.validateData(data)) {
            this._data = JSON.parse(JSON.stringify(data));
            this.sendDataToUsers();
        }
    }

    private validateData(data: any) {
        // TODO : validate data via schema;
        return typeof data === "object" && data !== null;
    }

    private setDataPart(dataPart: { part: string, data: any }, user: User) {
        let { part, data } = dataPart;
        data = JSON.parse(JSON.stringify(data));
        if (this.access.canWrite(user) && typeof part === "string") {
            this.setDataPath(part, data);
            this.sendDataPartToUsers(part, data);
        }
    }

    private setDataPath(_path: string, data: any) {
        const path = _path.split(".");
        let obj = this._data;
        let i: number;
        for (i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!obj.hasOwnProperty(key) || typeof obj[key] !== "object") {
                obj[key] = {};
            }
            obj = obj[path[i]];
        }
        const key = path[i];
        if (!obj.hasOwnProperty(key) || typeof obj[key] !== "object") {
            obj[key] = {};
        }
        obj[key] = data;
    }

    private sendDataPartToUsers(part: string, data: any) {
        Object.values(this._users)
            .forEach(user => user.sendDataPart(part, data));
    }

    private sendDataToUsers() {
        Object.values(this._users)
            .forEach(user => user.sendData(this._data));
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
}