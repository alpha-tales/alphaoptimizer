type WindowsCommand = (command: string, args: string[]) => string;
export declare function extractWindowsSid(output: string): string;
export declare function ensurePrivateDirectory(directory: string, platform?: NodeJS.Platform, run?: WindowsCommand): void;
export {};
