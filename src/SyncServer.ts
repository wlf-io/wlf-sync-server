import { createServer, Server } from "http";
import path from "path";
import socketIO from "socket.io";
import express from "express";
// import cookie from "cookie";
import User from "./User";
import redis from "redis";

export default class SyncServer {

    private users: { [k: string]: User } = {};
    private data: { [k: string]: any } = {};
    private config: { [k: string]: any };

    private readonly port: number;
    private app: express.Application;
    private server: Server;
    private socket: SocketIO.Server;
    private redisClient: redis.RedisClient;

    public static Factory(config: { [k: string]: any }) {
        return new SyncServer(config);
    }

    constructor(config: { [k: string]: any }) {
        this.config = JSON.parse(JSON.stringify(config));
        this.config.redis = this.config.redis || {};
        this.createApp();
        this.createServer();
        this.createSocket();
        this.createRedis();
    }

    public run() {
        this.listen();
    }

    private createApp() {
        this.app = express();
    }

    private createServer() {
        this.server = createServer(this.app);
    }

    private createSocket() {
        this.socket = socketIO(this.server);// , { path: "/ws" });
    }

    private createRedis() {
        this.redisClient = redis.createClient({
            host: this.config.redis.host || "127.0.0.120",
            port: this.config.redis.port || 6379,
            prefix: this.config.redis.prefix || "wlf-sync",
        });
        // setInterval(() => {
        //     this.redisClient.get("CAKECAKE", (err, rep) => {
        //         console.log("[Redis Reply]:", JSON.parse(rep));
        //     });
        // }, 5000);
    }

    private listen() {
        this.app.use("/", express.static(path.join(__dirname, 'public')));
        const port = this.config.port || 8080;
        this.server.listen(port, () => {
            console.log("Server started!!");
            console.log(`http://localhost:${port}`);
        });
        this.socket.on('connection', (socket: socketIO.Socket) => {
            console.log(`Client connected on port [${port}] ${socket.id}`);
            // const cookies = cookie.parse(socket.handshake.headers.cookie);
            // console.log(JSON.stringify(cookies));

            const user = User.Factory(socket);

            this.users[socket.id] = user;

            socket.on("setKey", (key: any) => {
                console.log("[Client SET KEY]: " + JSON.stringify(key));
                user.key = key;
                if (this.data.hasOwnProperty(key)) {
                    user.setData(this.data[key]);
                } else {
                    this.data[key] = null;
                    this.redisClient.get(key, (err, resp) => {
                        if (err === null) {
                            this.data[key] = JSON.parse(resp);
                            this.sendToUsers("", key);
                        } else {
                            console.log("REDIS ERR: ", err);
                        }
                    });
                }
            });

            socket.on("setData", (m: any) => {
                console.log("[Client SET DATA]: " + JSON.stringify(m));
                this.data[user.key] = m;
                this.sendToUsers(socket.id, user.key);
                this.redisClient.set(user.key, JSON.stringify(m));
            });

            socket.on("disconnect", () => {
                console.log("Client disconnected");
                delete this.users[socket.id];
            });
        });
    }

    private sendToUsers(src: string, key: string) {
        Object.values(this.users)
            .filter(user => user.key === key && user.socket.id !== src)
            .forEach(user => user.setData(this.data[key] || null));
    }
}