import User from "./User";



export default class AccessControl {
    private read: string[] = [];
    private write: string[] = [];
    private admin: string[] = [];
    private _owner: string | null = null;

    constructor(config: { [k: string]: any } = {}) {
        this._owner = config.owner || null;
        this.read = [...(config.read || [])];
        this.write = [...(config.write || [])];
        this.admin = [...(config.admin || [])];
    }

    getSave() {
        return {
            owner: this._owner,
            read: [...this.read],
            write: [...this.write],
            admin: [...this.admin],
        };
    }

    public attemptClaim(ident: string) {
        if (this._owner === null) {
            this._owner = ident;
        }
    }

    public addRead(user: User) {
        if (!this.canRead(user)) {
            this.read = [...new Set([...this.read, user.ident])];
        }
    }

    public remRead(ident: string, user: User) {
        if (this.canAdmin(user)) {
            this.read = [...this.read.filter(id => id !== ident)];
        }
    }

    public addWrite(addUser: User, user: User) {
        if (this.canAdmin(user) && !this.canWrite(addUser)) {
            this.write = [...new Set([...this.write, addUser.ident])];
        }
    }

    public remWrite(ident: string, user: User) {
        if (this.canAdmin(user)) {
            this.write = [...this.write.filter(id => id !== ident)];
        }
    }

    public addAdmin(addUser: User, user: User) {
        if (this.isOwner(user) && !this.canAdmin(addUser)) {
            this.admin = [...new Set([...this.admin, addUser.ident])];
        }
    }

    public remAdmin(ident: string, user: User) {
        if (this.isOwner(user)) {
            this.admin = [...this.admin.filter(id => id !== ident)];
        }
    }

    public canJoin(user: User): boolean {
        return this.canWrite(user) || this.read.includes(user.ident);
    }

    /**
     * @deprecated
     * @param user 
     */
    public canRead(user: User): boolean {
        return this.canJoin(user);
    }

    public canWrite(user: User): boolean {
        return this.canAdmin(user) || this.write.includes(user.ident);
    }

    public canAdmin(user: User): boolean {
        return this.isOwner(user) || this.admin.includes(user.ident);
    }

    public isOwner(user: User): boolean {
        return this._owner === user.ident;
    }

    get owner() {
        return this._owner;
    }
}