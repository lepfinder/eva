
// Simple in-memory storage for temporary credentials
// This survives page navigation but clears on app reload

class TempCredentialService {
    private credentials: Map<string, string> = new Map();

    setCredential(resourceId: string, url: string) {
        this.credentials.set(resourceId, url);
    }

    getCredential(resourceId: string): string | undefined {
        return this.credentials.get(resourceId);
    }

    clearCredential(resourceId: string) {
        this.credentials.delete(resourceId);
    }
}

export const tempCredentialService = new TempCredentialService();
