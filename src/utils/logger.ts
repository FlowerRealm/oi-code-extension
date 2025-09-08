export class Logger {
    private static instance: Logger;
    private prefix = '[OI-Code]';

    private constructor() {}

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public info(message: string, ...args: unknown[]): void {
        console.log(`${this.prefix} INFO: ${message}`, ...args);
    }

    public error(message: string, ...args: unknown[]): void {
        console.error(`${this.prefix} ERROR: ${message}`, ...args);
    }

    public warn(message: string, ...args: unknown[]): void {
        console.warn(`${this.prefix} WARN: ${message}`, ...args);
    }

    public debug(message: string, ...args: unknown[]): void {
        if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.debug(`${this.prefix} DEBUG: ${message}`, ...args);
        }
    }
}
