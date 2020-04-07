import { createServer, Server } from "http";
import { promisify } from "util";
import path from "path";
import socketIO from "socket.io";
import express from "express";
import cookie from "cookie";
import User from "./User";
import redis from "redis";
//import Data from "./Data";
import { v4 as uuidv4 } from "uuid";
import cookieParser from "cookie-parser";
import Room from "./Room";

export default class SyncServer {

    // private users: { [k: string]: User } = {};
    private rooms: { [k: string]: Room } = {};
    private config: { [k: string]: any };

    private app: express.Application;
    private server: Server;
    private socket: SocketIO.Server;
    private redisClient: redis.RedisClient | null = null;

    public static Factory(config: { [k: string]: any }) {
        return new SyncServer(config);
    }

    constructor(config: { [k: string]: any }) {
        this.config = JSON.parse(JSON.stringify(config)) || {};
        this.config.redis = this.config.redis || {};
        this.app = express();
        this.app.use(cookieParser());
        this.server = createServer(this.app);
        this.socket = socketIO(this.server);//, { path: "/ws" });
        this.createRedis();
    }

    public run() {
        this.listen();
    }

    private createRedis() {
        try {
            this.redisClient = redis.createClient({
                host: this.config.redis.host || "127.0.0.120",
                port: this.config.redis.port || 6379,
                prefix: this.config.redis.prefix || "wlf-sync",
            });
            this.redisClient.on("error", (err) => {
                console.log("[Redis ERROR]: " + err.code);
                this.redisClient?.end();
                this.redisClient = null;
                setTimeout(() => this.createRedis(), 5000);
            });
        } catch (e) {
            this.redisClient = null;
        }
    }

    private listen() {
        this.app.use("/", express.static(path.join(__dirname, 'public')));
        this.app.get("/*", (req, res) => {
            res.cookie(User.IdentCookie, req.cookies[User.IdentCookie] || uuidv4());
            res.cookie(User.NameCookie, req.cookies[User.NameCookie] || User.UniqueName());
            res.sendFile(__dirname + "/public/" + (this.config.index_file || "index.html"));
        });
        const port = this.config.port || 8080;
        this.server.listen(port, () => {
            console.log("Server started!!");
            console.log(`http://localhost:${port}`);
        });
        this.socket.on('connection', (socket: socketIO.Socket) => {
            const cookies = cookie.parse(socket.handshake.headers.cookie);
            console.log(cookies);
            if (cookies.hasOwnProperty(User.NameCookie) && cookies.hasOwnProperty(User.IdentCookie)) {
                socket.on("joinRoom", (keyPass: any) => this.joinRoom(socket, keyPass));
                socket.on("debug", () => this.debug(socket));
            } else {
                socket.disconnect();
            }
        });
    }

    private joinRoom(socket: socketIO.Socket, keyPass: { key: string, pass: string }) {
        let { key, pass } = keyPass;
        key = key.toLowerCase().replace(/[^0-9a-z]/gi, '');
        this.getRoomByKey(key)
            .then(room => {
                room.join(socket, pass);
            });
    }

    private getRoomByKey(key: string): Promise<Room> {
        if (this.rooms.hasOwnProperty(key)) {
            return Promise.resolve(this.rooms[key]);
        } else {
            return new Promise((res, rej) => {
                this.fetchFromRedis(key)
                    .then(raw => {
                        this.rooms[key] = Room.Factory(key)
                            .load(
                                JSON.parse(
                                    JSON.stringify(
                                        raw
                                    )
                                ) || {}
                            );
                        res(this.rooms[key]);
                    })
                    .catch(rej);
            });
        }
    }

    // private storeToRedis(key: string) {
    //     if (this.redisClient !== null && this.rooms.hasOwnProperty(key)) {
    //         this.redisClient.set(key, JSON.stringify(this.rooms[key].getSave()));
    //     }
    // }

    private fetchFromRedis(key: string): Promise<string | null> {
        console.log("[Start Redis Fetch]");
        if (this.redisClient !== null) {
            console.log("[Client Exists]");
            const getA = promisify(this.redisClient.get).bind(this.redisClient);
            return getA(key);
        } else {
            console.log("[Client doesn't exist]");
            return Promise.reject();
        }
    }

    private debug(socket: socketIO.Socket) {
        const data: { [k: string]: any } = {};
        for (const key in this.rooms) {
            data[key] = this.rooms[key].getSave();
            data[key]["users"] = this.rooms[key].getUsersData();
        }
        socket.emit("debug", data);
    }
}