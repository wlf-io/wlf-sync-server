import socketIO from "socket.io";


export default class User {
    private _socket: socketIO.Socket;
    private _key: string = "";

    public static Factory(socket: socketIO.Socket) {
        return new User(socket);
    }

    constructor(socket: socketIO.Socket) {
        this._socket = socket;
    }

    get key(): string {
        return this._key;
    }

    set key(key: string) {
        this._key = key;
    }

    get socket() {
        return this._socket;
    }

    public setData(m: any) {
        this._socket.emit("setData", m);
    }
}