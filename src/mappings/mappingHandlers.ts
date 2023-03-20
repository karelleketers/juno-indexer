import { Token, TransferEvent, Account, AccountBalance, AccountBalanceSnapshot } from "../types";
import { CosmosEvent } from "@subql/types-cosmos";
import { CODE_ID } from "../utils";
import { AccountParams } from "../interfaces/interfaces";

//Only allow relevant codeId(s) to pass through
const isCorrectCodeId = (ev: CosmosEvent) => {
  return (ev.msg.msg.decodedMsg.codeId.low && ev.msg.msg.decodedMsg.codeId.low in CODE_ID)
}

/**
 * Verifies if the token with the given address exists and updates its transfer statistics.
 * @param {string} address - The address of the token contract to verify.
 * @param {string} amount - The amount of the transfer.
 * @returns The ID and address of the verified token, or undefined if it doesn't exist.
 * @throws An error if the token verification fails.
 */
const verifyToken = async (address: string, amount: string): Promise<Partial<Token>> => {
  try { 
  // Attempt to retrieve the token with the given address from the database.
  const token = await Token.getByAddress(address);
  if (!token) return;

  // Increment the token's transfer count and update the total transferred amount.
  ++token.transferEventCount;
  token.totalTransferred = (Number(token.totalTransferred) + Number(amount)).toString();
  await token.save();

  // Return the ID and address of the verified token.
  return { id: token.id, address: token.address };
  } catch(e) {
    // Log and re-throw any errors that occur during the token verification.
    logger.error(`Failed to verify token: ${e.message}`);
    throw new Error(`Failed to verify token: ${e.message}`);
  }
}

/**
 * Creates a new token instance from a Cosmos SDK event and a contract address
 * @param {CosmosEvent} event - The Cosmos SDK event.
 * @param {string} address - The contract address.
 * @returns {Token} - The new token instance
 */
const createTokenFromEvent = (event: CosmosEvent, address: string) => {
   //Extract the decoded message from the event.
   const { msg: { decimals, name, symbol, initial_balances }, sender } = event.msg.msg.decodedMsg;

   // Create a new Token instance.
   const token = Token.create({
    id: `${event.tx.block.block.id}-${event.tx.idx}`,
    address: address || "",
    decimals,
    name,
    symbol,
    source: sender,
    transferEventCount: 0,
    totalSupply: initial_balances[0].amount,
    totalTransferred: "0"
  });

  return token;
}

/**
 * Creates a new token instance from a Cosmos SDK event and a contract address
 * @param {CosmosEvent} event - The Cosmos SDK event.
 * @param {string} tokenId - The ID of the token being transferred.
 * @param {string} amount - The amount of tokens being transferred.
 * @returns {TransferEvent} - The new transferEvent instance
 */
const createTransferEvent = (event: CosmosEvent, tokenId: string, amount: string) => {
  //Extract the decoded message from the event.
  const { msg , sender } = event.msg.msg.decodedMsg;
  //Extract the header from the event.
  const { height: block, time: timestamp } = event.msg.block.block.header

  // Create a new Transfer instance.
  const transfer = TransferEvent.create({
    id: `${event.tx.block.block.id}-${event.tx.idx}`,
    tokenId,
    amount,
    sender,
    destination: msg.transfer.recipient,
    block,
    timestamp,
    transaction: event.msg.tx.hash,
 });

 return transfer;
};

/**
 * Creates a new account with the given address.
 * @param {string} address - The address of the account to create.
 * @returns {Promise<void>} A Promise that resolves when the account is created.
 */
const createAccount = async (address: string): Promise<void> => {
  // Create a new Account object with the given address as ID and address.
  const account = Account.create({
    id: address,
    address,
  });

  // Save the account to the database.
  await account.save();
};

/**
 * Creates a new account balance snapshot for the given account and transfer event.
 * @param {Account} account The account for which to create the balance snapshot.
 * @param {AccountParams} accountParams An object containing the necessary parameters for creating the account balance snapshot.
 * @returns {Promise<void>} A Promise that resolves when the Account Balance Snapshot is created.
 */
const createAccountBalanceSnapshot = async (account: Account, accountParams: AccountParams): Promise<void> => {
  // Extract the necessary parameters from the `accountParams` object.
  const { tokenId, transfer, tokenAddress } = accountParams;

  // Create a new account balance snapshot with the extracted parameters and save it to the database.
  const accountBalanceSnapshot = AccountBalanceSnapshot.create({
    id: `${account.address}-${tokenAddress}`,
    accountId: account.id,
    tokenId,
    amount: transfer.amount,
    eventId: transfer.id,
    block: transfer.block,
    timestamp: transfer.timestamp,
    transaction: transfer.transaction
  });
  await accountBalanceSnapshot.save();
}

/**
 * Create an account balance entry and associated snapshot for the given account.
 * @param {Account} account - The account to create the balance entry for.
 * @param {AccountParams} accountParams - An object containing the necessary parameters for the account.
 * @returns {Promise<void>} 
 */
const createAccountBalance = async (account: Account, accountParams: AccountParams): Promise<void> => {
  const { tokenId, transfer, tokenAddress } = accountParams;
  
  // Create a new account balance entry.
  const accountBalance = AccountBalance.create({
    id: `${account.address}-${tokenAddress}`,
    accountId: account.id,
    tokenId,
    amount: transfer.amount,
    block: transfer.block,
    modified: transfer.timestamp,
    transaction: transfer.transaction
  });

  await accountBalance.save();

  // Create a new account balance snapshot for the account.
  createAccountBalanceSnapshot(account, accountParams);
};

/**
 * Update the account balance for the given account and transfer.
 * If the account balance does not exist, create it.
 *
 * @param {Account} account The account to update
 * @param {AccountParams} accountParams An object containing additional parameters for the account
 * @returns {Promise<void>}
 */
const updateAccountBalance = async (account: Account, accountParams: AccountParams): Promise<void> => {
  // Extract necessary variables from the accountParams object
  const { transfer, tokenAddress } = accountParams;

  // Get the ID of the account balance from the account address and token address
  const accountBalanceId = `${account.address}-${tokenAddress}`

  // Retrieve the account balance from the database, or create it if it does not exist
  const accountBalance = await AccountBalance.get(accountBalanceId);
  if (!accountBalance) {
    createAccountBalance(account, accountParams);
    return;
  }

  // Calculate the amount to change based on whether the account is the sender or receiver of the transfer
  const amountToChange = account.address === transfer.sender ? -(transfer.amount) : transfer.amount;

  // Update the account balance and account with the new values
  accountBalance.amount += amountToChange;
  accountBalance.block = transfer.block;
  accountBalance.modified = transfer.timestamp;
  accountBalance.transaction = transfer.transaction;
  await accountBalance.save();

  // Create a new account balance snapshot for the account.
  createAccountBalanceSnapshot(account, accountParams);
};

/**
 * Verifies whether an account exists, then either creates a new account and account balance or updates an existing account balance
 * @param {string} address - the address of the account
 * @param {AccountParams} accountParams - object containing account-related parameters
 * @returns {Promise<void>}
 */
const verifyAccount = async (address: string, accountParams: AccountParams): Promise<void> => {
  const account = await Account.get(address);

  !account ? 
  // create a new account and account balance if the account does not exist
  (createAccount(address) && createAccountBalance(account, accountParams)):
  // update the existing account balance if the account exists
  updateAccountBalance(account, accountParams)
};


/**
 * Handles the instantiate event by creating a new token.
 * @param {CosmosEvent} event - The Cosmos SDK event.
 * @returns {Promise<void>}
 */
export const handleInstantiateEvent = async (event: CosmosEvent): Promise<void> => {
  try { 
    // Check if the event is an instantiate event with the correct code ID.
    if (!isCorrectCodeId(event)) return;
    
    // Find the contract address from the event attributes.
    const contractAddress = event.event.type === "instantiate" && event.event.attributes.find(attribute => attribute.key === "_contract_address")?.value;
    
    // TO-DO: Find token info from the contract address.

    // Create a new token with data from the instantiate event.
    const token = createTokenFromEvent(event, contractAddress)
    
    // Save the token to the database.
    await token.save();
  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Instantiate Event Handler Failed: ${e.message}`);
    throw new Error(`Instantiate Event Handler Failed: ${e.message}`);
  }
}


/**
 * Handles the execute event by creating a new transfer.
 * @param {CosmosEvent} event - The Cosmos SDK event.
 */

export const handleExecuteEvent = async (event: CosmosEvent): Promise<void> => {
  try { 
    // Get the contract address and transfer amount from the decoded message
    const { contract, msg } = event.msg.msg.decodedMsg;
    const amount = msg.transfer?.amount ?? 0;

    // Verify the token and get the token ID
    const token = await verifyToken(contract ?? "", amount);
    if (!token) return;

    // Create a new transfer with data from the execute event.
    const transfer = createTransferEvent(event, token.id, amount);

    // Save the transfer to the database.
    await transfer.save();

    const accountParams = {
      tokenId: token.id,
      tokenAddress: token.address,
      transfer
    };

    //handle Account & Balance of Transfer Sender
    verifyAccount(transfer.sender, accountParams);

    //handle Account & Balance of Transer receiver
    verifyAccount(transfer.destination, accountParams);

  } catch(e) {
    // Log and throw an error if the handler fails.
    logger.error(`Execute Event Failed: ${e.message}`);
    throw new Error(`Execute Event Failed: ${e.message}`);
  }
}