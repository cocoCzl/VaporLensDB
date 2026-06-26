import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} missing: ${value}`)
  }
}

const rustConnectionModel = read('src-tauri/src/models/connection.rs')
const rustConfigStore = read('src-tauri/src/services/config_store.rs')
const rustConnectionManager = read('src-tauri/src/services/connection_manager.rs')
const rustSshTunnel = read('src-tauri/src/services/ssh_tunnel.rs')
const rustError = read('src-tauri/src/models/error.rs')
const tsTypes = read('src/types/connection.ts')
const connectionForm = read('src/components/connection/ConnectionForm.tsx')

includesAll(
  rustConnectionModel,
  [
    'pub ssh_tunnel: Option<SshTunnelConfig>',
    'pub struct SshTunnelConfig',
    'pub enum SshAuthMethod',
    'Password',
    'PrivateKey',
  ],
  'Rust connection model',
)

includesAll(
  rustConfigStore,
  [
    'add ssh tunnel connection fields',
    'ssh_tunnel_json',
    'ssh_password_encrypted',
    'ssh_private_key_passphrase_encrypted',
    'decrypt_ssh_tunnel',
    'stores_connection_ssh_tunnel_without_plaintext_secrets',
  ],
  'config store persistence',
)

includesAll(
  rustConnectionManager,
  [
    'struct ActiveConnection',
    '_ssh_tunnel: Option<SshTunnel>',
    'open_tunnel(config).await',
    'create_driver(&runtime_config',
  ],
  'connection lifecycle',
)

includesAll(
  rustSshTunnel,
  [
    'Command::new("ssh")',
    'SSH_ASKPASS',
    'ExitOnForwardFailure=yes',
    'rewrite_connection_url',
    'wait_until_forward_ready',
  ],
  'ssh tunnel manager',
)

includesAll(
  rustError,
  ['SshTunnelError', 'SSH_TUNNEL_FAILED', 'phase=ssh_tunnel'],
  'ssh tunnel errors',
)

includesAll(
  tsTypes + connectionForm,
  [
    'sshTunnel?: SshTunnelInput | null',
    "export type SshAuthMethod = 'password' | 'privateKey'",
    "t('connectionForm.enableSshTunnel')",
    "t('connectionForm.sshHost')",
    "t('connectionForm.sshAuth')",
    "t('connectionForm.privateKeyPath')",
    'normalizeSshTunnel',
  ],
  'frontend ssh tunnel form',
)

console.log('SSH tunnel smoke passed.')
