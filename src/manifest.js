const manifest = {
  id: 'snyxex.space-sandbox-provider',
  apiVersion: 1,
  version: '0.1.0-alpha.1',
  displayName: 'SPACE Firecracker Sandbox (Alpha)',
  description: 'Experimental self-hosted SPACE execution environment for Paperclip.',
  author: 'Snyxex',
  categories: ['automation'],
  capabilities: ['environment.drivers.register'],
  entrypoints: {worker: './dist/worker.js'},
  environmentDrivers: [{
    driverKey: 'space', kind: 'sandbox_provider',
    displayName: 'SPACE (Firecracker)',
    description: 'Isolated Firecracker VM provided by SPACE; preproduction proof of concept.',
    configSchema: {type: 'object', required: ['apiToken', 'apiUrl', 'dataPlaneUrl'], properties: {
      apiUrl: {type: 'string', description: 'SPACE management API origin (HTTPS preferred; local private HTTP opt-in).'},
      dataPlaneUrl: {type: 'string', description: 'SPACE command-stream data-plane origin.'},
      allowInsecurePrivateHttp: {type: 'boolean', default:false, description: 'Explicitly permit plaintext HTTP only to literal RFC1918 addresses; single-host development only.'},
      apiToken: {type: 'string', format:'secret-ref', description: 'SPACE management token; do not publish or commit.'},
      template: {type:'string', default:'seed:latest', description:'SPACE template reference. Must include required agent runtimes for real jobs.'},
      timeoutMs: {type:'integer', default:300000, minimum:1000, maximum:3600000},
      vcpu: {type:'integer', minimum:1, maximum:4},
      memory_mib: {type:'integer', minimum:256, maximum:8192},
      disk_mib: {type:'integer', minimum:512, maximum:20480},
      reuseLease: {type:'boolean', default:false, description:'Not yet supported in this alpha.'}
    }}
  }]
};
export default manifest;
