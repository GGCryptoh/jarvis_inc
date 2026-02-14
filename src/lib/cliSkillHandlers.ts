/**
 * CLI Skill Handlers — Browser-side HTTP execution for CLI-type skills
 * =====================================================================
 * Skills with connection type 'cli' that wrap public HTTP APIs can execute
 * directly from the browser via fetch(). No LLM model required.
 */

export interface CLISkillResult {
  success: boolean;
  text: string;
}

type CLIHandler = (commandName: string, params: Record<string, unknown>) => Promise<CLISkillResult>;

// ---------------------------------------------------------------------------
// Weather CLI handler (wttr.in)
// ---------------------------------------------------------------------------

async function executeWeatherCli(
  commandName: string,
  params: Record<string, unknown>,
): Promise<CLISkillResult> {
  const location = params.location as string;
  if (!location) return { success: false, text: 'Weather requires a location parameter' };

  try {
    if (commandName === 'get_current') {
      const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      if (!resp.ok) throw new Error(`wttr.in ${resp.status}`);
      const data = await resp.json();
      const c = data.current_condition?.[0];
      const area = data.nearest_area?.[0];
      const city = area?.areaName?.[0]?.value ?? location;
      return {
        success: true,
        text: `${c?.weatherDesc?.[0]?.value ?? 'Unknown'} in ${city}: ${c?.temp_F ?? '?'}°F (${c?.temp_C ?? '?'}°C), feels like ${c?.FeelsLikeF ?? c?.temp_F}°F. Humidity ${c?.humidity ?? '?'}%, wind ${c?.windspeedMiles ?? '?'} mph.`,
      };
    }

    if (commandName === 'get_moon_phase') {
      const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      if (!resp.ok) throw new Error(`wttr.in ${resp.status}`);
      const data = await resp.json();
      const astronomy = data.weather?.[0]?.astronomy?.[0];
      const area = data.nearest_area?.[0];
      const city = area?.areaName?.[0]?.value ?? location;
      return {
        success: true,
        text: `Moon phase for ${city}: ${astronomy?.moon_phase ?? 'Unknown'}. Moonrise: ${astronomy?.moonrise ?? '?'}, Moonset: ${astronomy?.moonset ?? '?'}. Illumination: ${astronomy?.moon_illumination ?? '?'}%.`,
      };
    }

    // get_forecast (default)
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
    if (!resp.ok) throw new Error(`wttr.in ${resp.status}`);
    const data = await resp.json();
    const c = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    const city = area?.areaName?.[0]?.value ?? location;
    const region = area?.region?.[0]?.value ?? '';
    const country = area?.country?.[0]?.value ?? '';
    const days = Number(params.days ?? 3);

    let summary = `**${city}${region ? `, ${region}` : ''}${country ? ` (${country})` : ''}** — ${c?.weatherDesc?.[0]?.value ?? 'Unknown'}\n`;
    summary += `Temperature: ${c?.temp_F ?? '?'}°F (${c?.temp_C ?? '?'}°C), feels like ${c?.FeelsLikeF ?? c?.temp_F}°F\n`;
    summary += `Humidity: ${c?.humidity ?? '?'}%, Wind: ${c?.windspeedMiles ?? '?'} mph\n`;

    const forecasts = (data.weather ?? []).slice(0, days);
    if (forecasts.length > 0) {
      summary += `\n**${forecasts.length}-Day Forecast:**\n`;
      for (const day of forecasts) {
        const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value ?? '—';
        const rain = day.hourly?.[4]?.chanceofrain ?? '0';
        summary += `- ${day.date ?? ''}: ${dayDesc}, ${day.mintempF ?? '?'}–${day.maxtempF ?? '?'}°F, ${rain}% rain\n`;
      }
    }

    return { success: true, text: summary };
  } catch (err) {
    return { success: false, text: `Weather fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// WHOIS / RDAP handler (rdap.org)
// ---------------------------------------------------------------------------

async function executeWhoisLookup(
  commandName: string,
  params: Record<string, unknown>,
): Promise<CLISkillResult> {
  try {
    if (commandName === 'ip_lookup') {
      const ip = params.ip as string;
      if (!ip) return { success: false, text: 'IP lookup requires an ip parameter' };
      const resp = await fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`);
      if (!resp.ok) throw new Error(`RDAP ${resp.status}: ${resp.statusText}`);
      const data = await resp.json();

      const name = data.name ?? '—';
      const handle = data.handle ?? '—';
      const cidr = data.cidr0_cidrs?.map((c: { v4prefix?: string; v6prefix?: string; length: number }) =>
        `${c.v4prefix ?? c.v6prefix ?? '?'}/${c.length}`).join(', ') ?? '—';
      const country = data.country ?? '—';
      const startAddr = data.startAddress ?? '—';
      const endAddr = data.endAddress ?? '—';
      const entities = (data.entities ?? []).map((e: { handle?: string; vcardArray?: unknown[][] }) => e.handle).filter(Boolean).join(', ') || '—';

      return {
        success: true,
        text: `**IP: ${ip}**\nNetwork: ${name} (${handle})\nCIDR: ${cidr}\nRange: ${startAddr} – ${endAddr}\nCountry: ${country}\nEntities: ${entities}`,
      };
    }

    // domain_lookup (default)
    const domain = params.domain as string;
    if (!domain) return { success: false, text: 'WHOIS requires a domain parameter' };
    const resp = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    if (!resp.ok) throw new Error(`RDAP ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();

    const status = (data.status ?? []).join(', ') || '—';
    const nameservers = (data.nameservers ?? []).map((ns: { ldhName?: string }) => ns.ldhName).filter(Boolean).join(', ') || '—';

    // Extract dates from events
    const events = data.events ?? [];
    const registered = events.find((e: { eventAction: string }) => e.eventAction === 'registration')?.eventDate ?? '—';
    const expires = events.find((e: { eventAction: string }) => e.eventAction === 'expiration')?.eventDate ?? '—';
    const updated = events.find((e: { eventAction: string }) => e.eventAction === 'last changed')?.eventDate ?? '—';

    // Registrar from entities
    const registrar = (data.entities ?? []).find((e: { roles?: string[] }) =>
      e.roles?.includes('registrar'))?.vcardArray?.[1]?.find((v: unknown[]) => v[0] === 'fn')?.[3] ?? '—';

    return {
      success: true,
      text: `**Domain: ${domain}**\nRegistrar: ${registrar}\nStatus: ${status}\nNameservers: ${nameservers}\nRegistered: ${registered}\nExpires: ${expires}\nLast Updated: ${updated}`,
    };
  } catch (err) {
    return { success: false, text: `WHOIS lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// DNS Lookup handler (Cloudflare DoH)
// ---------------------------------------------------------------------------

async function executeDnsLookup(
  commandName: string,
  params: Record<string, unknown>,
): Promise<CLISkillResult> {
  const domain = params.domain as string;
  if (!domain) return { success: false, text: 'DNS lookup requires a domain parameter' };

  async function queryDNS(name: string, type: string): Promise<{ type: string; records: string[] }> {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: 'application/dns-json' } },
    );
    if (!resp.ok) return { type, records: [] };
    const data = await resp.json();
    const answers = (data.Answer ?? []) as { data: string; TTL: number }[];
    return { type, records: answers.map(a => `${a.data} (TTL: ${a.TTL}s)`) };
  }

  try {
    if (commandName === 'full_report') {
      const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'SOA'];
      const results = await Promise.all(types.map(t => queryDNS(domain, t)));

      let report = `**DNS Report: ${domain}**\n`;
      for (const r of results) {
        if (r.records.length > 0) {
          report += `\n**${r.type}:**\n`;
          for (const rec of r.records) report += `  ${rec}\n`;
        }
      }
      const hasAny = results.some(r => r.records.length > 0);
      if (!hasAny) report += '\nNo DNS records found.';

      return { success: true, text: report.trim() };
    }

    // query (default) — single record type
    const type = ((params.type as string) ?? 'A').toUpperCase();
    const result = await queryDNS(domain, type);

    if (result.records.length === 0) {
      return { success: true, text: `**${domain}** — No ${type} records found.` };
    }

    let text = `**${domain} ${type} Records:**\n`;
    for (const rec of result.records) text += `  ${rec}\n`;
    return { success: true, text: text.trim() };
  } catch (err) {
    return { success: false, text: `DNS lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const CLI_HANDLERS: Record<string, CLIHandler> = {
  'weather-cli': executeWeatherCli,
  'whois-lookup': executeWhoisLookup,
  'dns-lookup': executeDnsLookup,
};

/**
 * Check if a skill ID has a browser-side CLI handler.
 */
export function hasCLIHandler(skillId: string): boolean {
  return skillId in CLI_HANDLERS;
}

/**
 * Execute a CLI skill via its browser-side HTTP handler.
 * Returns null if no handler exists for this skill.
 */
export async function executeCLISkill(
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
): Promise<CLISkillResult | null> {
  const handler = CLI_HANDLERS[skillId];
  if (!handler) return null;
  return handler(commandName, params);
}
