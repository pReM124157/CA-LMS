export class AutoSubmitPolicy {
  public constructor(private readonly enabled: boolean, hosts: string[]) { this.hosts = new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean)); }
  private readonly hosts: Set<string>;
  permits(url: string): boolean { try { return this.enabled && this.hosts.has(new URL(url).hostname.toLowerCase()); } catch { return false; } }
}
