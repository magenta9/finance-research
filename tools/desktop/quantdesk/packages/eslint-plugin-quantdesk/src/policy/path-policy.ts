export interface PolicyPathEntry {
    path: string;
    reason: string;
}

const normalizePath = (filePath: string) => filePath.replace(/\\/g, '/');

const stripLeadingSlash = (value: string) => value.replace(/^\/+/, '');

const matchesExactPath = (filePath: string, policyPath: string) => (
    filePath === policyPath || filePath.endsWith(`/${policyPath}`)
);

const matchesDirectoryPolicy = (filePath: string, policyPath: string) => {
    const prefix = policyPath.slice(0, -3).replace(/\/+$/, '');

    return (
        filePath === prefix
        || filePath.startsWith(`${prefix}/`)
        || filePath.endsWith(`/${prefix}`)
        || filePath.includes(`/${prefix}/`)
    );
};

export const matchesPolicyPath = (filePath: string, entry: PolicyPathEntry) => {
    const normalizedFilePath = stripLeadingSlash(normalizePath(filePath));
    const normalizedPolicyPath = stripLeadingSlash(normalizePath(entry.path));

    if (normalizedPolicyPath.endsWith('/**')) {
        return matchesDirectoryPolicy(normalizedFilePath, normalizedPolicyPath);
    }

    return matchesExactPath(normalizedFilePath, normalizedPolicyPath);
};

export const isPolicyAllowed = (filePath: string, entries: PolicyPathEntry[]) => (
    entries.some((entry) => matchesPolicyPath(filePath, entry))
);