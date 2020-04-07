import socketIO from "socket.io";
import cookie from "cookie";
import { v4 as uuidv4 } from "uuid";
import { uniqueNamesGenerator, Config as ungConfig, adjectives, colors, animals } from "unique-names-generator";


export default class User {

    public static readonly NameCookie = "wlf_sync_name";
    public static readonly IdentCookie = "wlf_sync_ident";

    private socket: socketIO.Socket;
    private _ident: string;
    private _name: string;
    private _key: string;
    private _updateHooks: Array<(user: User) => void> = [];
    private _disconnectHooks: Array<(user: User) => void> = [];

    public static Factory(socket: socketIO.Socket, key: string) {
        return new User(socket, key);
    }

    constructor(socket: socketIO.Socket, key: string) {
        this.socket = socket;
        const cookies = cookie.parse(socket.handshake.headers.cookie);
        this._ident = cookies[User.IdentCookie] || uuidv4();
        this._name = cookies[User.NameCookie] || User.UniqueName();
        this._key = key;
        this.emit("setName", this.name);
        this.emit("setIdent", this.ident);
        this.hookSocket();
    }

    public static UniqueName() {
        const config: ungConfig = {
            dictionaries: [adjectives, colors, animals],
            separator: " ",
            length: 3,
        };
        return uniqueNamesGenerator(config);
    }

    // get socket() {
    //     return this._socket;
    // }

    get ident() {
        return this._ident;
    }

    get name() {
        return this._name;
    }

    public sendOneTimePass(pass: string) {
        this.emit("oneTimePass", pass);
    }

    public sendData(m: any) {
        this.emit("setData", m);
    }

    public sendDataPart(part: string, data: any) {
        this.emit("setDataPart", { part, data });
    }

    public sendUsers(m: any) {
        this.emit("setUsers", m);
    }

    public sendOwnUser(u: any) {
        this.emit("yourUser", u);
    }

    public relay(sender: string, data: any) {
        this.emit("relay", { sender, data });
    }

    public emit(event: string, data: any) {
        this.socket.emit(event, { room: this._key, data });
    }

    public onUpdate(cb: (user: User) => void): User {
        this._updateHooks.push(cb);
        return this;
    }

    public onDisconnect(cb: (user: User) => void): User {
        this._disconnectHooks.push(cb);
        return this;
    }

    public onSocket(event: string, cb: (data: any) => any): User {
        this.socket.on(event, evt => cb(evt));
        return this;
    }

    private hookSocket() {
        this.socket.on("updateUser", data => this.update(data));
        this.socket.on("disconnect", () => this.disconnect());
    }

    private update(data: { [k: string]: any }) {
        const { name } = data;
        let update = false;
        if (typeof name === "string" && name.length > 2) {
            this._name = name;
            update = true;
        }
        if (update) {
            this._updateHooks.forEach(hook => hook(this));
        }
    }

    private disconnect() {
        this._disconnectHooks.forEach(hook => hook(this));
    }
}