#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Symbol,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Votes(Symbol),
    Voted(Address),
    Question,
}

#[contract]
pub struct PollContract;

#[contractimpl]
impl PollContract {
    /// Initialize the poll with a question (call once after deploy)
    pub fn init(env: Env, question: Symbol) {
        if env.storage().instance().has(&DataKey::Question) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Question, &question);
        let yes = symbol_short!("yes");
        let no = symbol_short!("no");
        env.storage().persistent().set(&DataKey::Votes(yes), &0u32);
        env.storage().persistent().set(&DataKey::Votes(no), &0u32);
        env.storage().instance().extend_ttl(100_000, 100_000);
    }

    /// Cast a vote: option must be "yes" or "no"
    pub fn vote(env: Env, voter: Address, option: Symbol) {
        voter.require_auth();

        if env.storage().persistent().has(&DataKey::Voted(voter.clone())) {
            panic!("already voted");
        }

        let yes = symbol_short!("yes");
        let no = symbol_short!("no");

        if option != yes && option != no {
            panic!("invalid option");
        }

        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Votes(option.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Votes(option.clone()), &(count + 1));

        env.storage()
            .persistent()
            .set(&DataKey::Voted(voter.clone()), &true);

        env.storage().persistent().extend_ttl(
            &DataKey::Votes(option.clone()),
            100_000,
            100_000,
        );
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Voted(voter.clone()), 100_000, 100_000);

        env.events()
            .publish((symbol_short!("vote"), option), voter);
    }

    /// Get the vote count for an option ("yes" or "no")

    pub fn get_votes(env: Env, option: Symbol) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Votes(option))
            .unwrap_or(0)
    }

    /// Check whether an address has already voted
    pub fn has_voted(env: Env, voter: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Voted(voter))
    }

    /// Get the poll question symbol
    pub fn question(env: Env) -> Symbol {
        env.storage()
            .instance()
            .get(&DataKey::Question)
            .unwrap_or(symbol_short!("unknown"))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _, Env};

    fn setup() -> (Env, soroban_sdk::Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PollContract, ());
        (env, contract_id)
    }

    #[test]
    fn test_init_and_question() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        let q = symbol_short!("rust");
        client.init(&q);
        assert_eq!(client.question(), q);
    }

    #[test]
    fn test_vote_yes_increments_count() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        client.init(&symbol_short!("rust"));
        let voter = Address::generate(&env);
        client.vote(&voter, &symbol_short!("yes"));
        assert_eq!(client.get_votes(&symbol_short!("yes")), 1);
        assert_eq!(client.get_votes(&symbol_short!("no")), 0);
    }

    #[test]
    fn test_vote_no_increments_count() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        client.init(&symbol_short!("rust"));
        let voter = Address::generate(&env);
        client.vote(&voter, &symbol_short!("no"));
        assert_eq!(client.get_votes(&symbol_short!("no")), 1);
        assert_eq!(client.get_votes(&symbol_short!("yes")), 0);
    }

    #[test]
    fn test_has_voted_true_after_voting() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        client.init(&symbol_short!("rust"));
        let voter = Address::generate(&env);
        assert!(!client.has_voted(&voter));
        client.vote(&voter, &symbol_short!("yes"));
        assert!(client.has_voted(&voter));
    }

    #[test]
    #[should_panic(expected = "already voted")]
    fn test_cannot_vote_twice() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        client.init(&symbol_short!("rust"));
        let voter = Address::generate(&env);
        client.vote(&voter, &symbol_short!("yes"));
        client.vote(&voter, &symbol_short!("no"));
    }

    #[test]
    #[should_panic(expected = "invalid option")]
    fn test_invalid_option_rejected() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        client.init(&symbol_short!("rust"));
        let voter = Address::generate(&env);
        client.vote(&voter, &symbol_short!("maybe"));
    }

    #[test]
    fn test_multiple_voters() {
        let (env, contract_id) = setup();
        let client = PollContractClient::new(&env, &contract_id);
        client.init(&symbol_short!("rust"));
        for _ in 0..3 {
            client.vote(&Address::generate(&env), &symbol_short!("yes"));
        }
        for _ in 0..2 {
            client.vote(&Address::generate(&env), &symbol_short!("no"));
        }
        assert_eq!(client.get_votes(&symbol_short!("yes")), 3);
        assert_eq!(client.get_votes(&symbol_short!("no")), 2);
    }
}
