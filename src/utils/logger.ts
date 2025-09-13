export class Logger {
    private static instance: Logger;
    private prefix = '[OI-Code]';
    private context: string;

    public constructor(context?: string) {
        this.context = context || '';
    }

    public static getInstance(context?: string): Logger {
        if (!Logger.instance && !context) {
            Logger.instance = new Logger();
        }
        return context ? new Logger(context) : Logger.instance;
    }

    public info(message: string, ...args: unknown[]): void {
        const prefix = this.context ? `[${this.context}]` : this.prefix;
        console.log(`${prefix} INFO: ${message}`, ...args);
    }

    public error(message: string, ...args: unknown[]): void {
        const prefix = this.context ? `[${this.context}]` : this.prefix;
        console.error(`${prefix} ERROR: ${message}`, ...args);
    }

    public warn(message: string, ...args: unknown[]): void {
        const prefix = this.context ? `[${this.context}]` : this.prefix;
        console.warn(`${prefix} WARN: ${message}`, ...args);
    }

    public debug(message: string, ...args: unknown[]): void {
        if (process.env.NODE_ENV === 'development') {
            const prefix = this.context ? `[${this.context}]` : this.prefix;
            // eslint-disable-next-line no-console
            console.debug(`${prefix} DEBUG: ${message}`, ...args);
        }
    }
}
