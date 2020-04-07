
import Server from "./SyncServer";

const config = {
    port: process.env.PORT || 8080,
    redis: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
        prefix: process.env.REDIS_PREFIX || "wlf-sync",
    },
    indexFile: process.env.INDEX_FILE || "index.html",
};

Server.Factory(config).run();