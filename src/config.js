export const WORKSPACE = '/paperclip-workspace';

function origin(raw, name, allowInsecurePrivateHttp = false) {
  if (typeof raw !== 'string' || !raw) throw new Error(`${name} is required`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${name} is not a valid URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be a bare HTTP(S) origin`);
  // No management/attachment credentials over public plaintext HTTP.
  // Only literal loopback/RFC1918 addresses permitted in explicit local-dev mode.
  const host = url.hostname;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  const privateV4 = Boolean(ip && ip.every(n => n >= 0 && n <= 255) &&
    (ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
    (ip[0] === 192 && ip[1] === 168)));
  if (url.protocol === 'http:' && !(loopback || (allowInsecurePrivateHttp && privateV4))) {
    throw new Error(`${name}: use HTTPS, or opt in to private HTTP with allowInsecurePrivateHttp`);
  }
  return url.origin;
}

export function parseConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Missing configuration');
  const allowInsecurePrivateHttp = raw.allowInsecurePrivateHttp === true;
  const apiUrl = origin(raw.apiUrl, 'apiUrl', allowInsecurePrivateHttp);
  const dataPlaneUrl = origin(raw.dataPlaneUrl, 'dataPlaneUrl', allowInsecurePrivateHttp);
  const token = typeof raw.apiToken === 'string' ? raw.apiToken.trim() : '';
  if (!token) throw new Error('apiToken is required (Paperclip secret reference)');
  const template = raw.template ?? 'seed:latest';
  if (typeof template !== 'string' || template.length < 1 || template.length > 200 || !/^[A-Za-z0-9._:/@-]+$/.test(template)) {
    throw new Error('Invalid template reference');
  }
  const timeoutMs = Number(raw.timeoutMs ?? 300_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000) throw new Error('timeoutMs must be 1000..3600000');
  const runtimeProfile = raw.runtimeProfile ?? 'none';
  if (!['none', 'node-tooling', 'codex'].includes(runtimeProfile)) {
    throw new Error('Invalid runtimeProfile; use none, node-tooling or codex');
  }
  const transferMode = raw.transferMode ?? 'disabled';
  if (!['disabled', 'command-experimental', 'native-incubating'].includes(transferMode)) {
    throw new Error('Invalid transferMode; use disabled, command-experimental or native-incubating');
  }
  const probeScenario = raw.probeScenario ?? 'command';
  if (!['command', 'node-file-test'].includes(probeScenario)) {
    throw new Error('Invalid probeScenario; use command or node-file-test');
  }
  if (probeScenario === 'node-file-test' && (transferMode !== 'native-incubating' || runtimeProfile === 'none')) {
    throw new Error('node-file-test requires transferMode native-incubating and runtimeProfile node-tooling or codex');
  }
  const resources = {};
  for (const [key, lower, upper] of [['vcpu',1,4], ['memory_mib',256,8192], ['disk_mib',512,20480]]) {
    if (raw[key] !== undefined && raw[key] !== null) {
      const value = Number(raw[key]);
      if (!Number.isInteger(value) || value < lower || value > upper) throw new Error(`Invalid ${key}`);
      resources[key] = value;
    }
  }
  if (raw.reuseLease === true) throw new Error('reuseLease is not yet supported in v0.1-alpha');
  return {apiUrl, dataPlaneUrl, token, template, timeoutMs, resources, allowInsecurePrivateHttp, transferMode, runtimeProfile, probeScenario};
}

export function identifier(value, prefix) {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}[A-Za-z0-9_-]{1,200}$`).test(value)) {
    throw new Error(`Invalid ${prefix} identifier in SPACE response`);
  }
  return value;
}

export function shellQuote(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid shell value');
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
