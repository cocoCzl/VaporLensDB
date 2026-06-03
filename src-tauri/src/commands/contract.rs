use serde::{Deserialize, Serialize};

const COMMAND_CONTRACTS_JSON: &str = include_str!("../../../src/shared/command-contracts.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContract {
    pub name: String,
    pub namespace: String,
    pub args: String,
    pub response: String,
    pub status: String,
}

pub fn command_contracts() -> Vec<CommandContract> {
    serde_json::from_str(COMMAND_CONTRACTS_JSON).expect("command contracts JSON is valid")
}

#[tauri::command]
pub fn list_command_contracts() -> Vec<CommandContract> {
    command_contracts()
}

#[cfg(test)]
mod tests {
    use super::command_contracts;

    #[test]
    fn contract_covers_required_namespaces() {
        let contracts = command_contracts();
        for namespace in [
            "connection",
            "query",
            "metadata",
            "driver",
            "settings",
            "history",
            "task",
        ] {
            assert!(
                contracts
                    .iter()
                    .any(|contract| contract.namespace == namespace),
                "missing namespace: {namespace}"
            );
        }
    }

    #[test]
    fn active_contracts_have_non_empty_shapes() {
        let contracts = command_contracts();
        for contract in contracts
            .iter()
            .filter(|contract| contract.status == "active")
        {
            assert!(!contract.name.is_empty(), "missing command name");
            assert!(
                !contract.args.is_empty(),
                "missing args shape for {}",
                contract.name
            );
            assert!(
                !contract.response.is_empty(),
                "missing response shape for {}",
                contract.name
            );
        }
    }
}
