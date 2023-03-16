import { Token, TransferEvent } from "../types";
import { CosmosEvent } from "@subql/types-cosmos";
import { CODE_ID } from "../utils";

//Only allow relevant codeId(s) to pass through
const isCorrectCodeId = (ev: CosmosEvent) => {
  return (ev.msg.msg.decodedMsg.codeId.low && ev.msg.msg.decodedMsg.codeId.low in CODE_ID)
}

/**
 * Verifies if the token with the given address exists and updates its transfer statistics.
 * @param address - The address of the token contract to verify.
 * @param amount - The amount of the transfer.
 * @returns The ID of the verified token, or undefined if it doesn't exist.
 * @throws An error if the token verification fails.
 */

const verifyToken = async (address: string, amount: string): Promise<string | undefined> => {
  try { 
  // Attempt to retrieve the token with the given address from the database.
  const token = await Token.getByAddress(address);
  if (!token) return;

  // Increment the token's transfer count and update the total transferred amount.
  ++token.transferEventCount;
  token.totalTransferred = (Number(token.totalTransferred) + Number(amount)).toString();
  await token.save();

  // Return the ID of the verified token.
  return token.id;
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
}


/**
 * Handles the instantiate event by creating a new token.
 * @param {CosmosEvent} event - The Cosmos SDK event.
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
    const tokenId = await verifyToken(contract ?? "", amount);
    if (!tokenId) return;

    // Create a new transfer with data from the execute event.
    const transfer = createTransferEvent(event, tokenId, amount);

    // Save the transfer to the database.
    await transfer.save();
  } catch(e) {
    // Log and throw an error if the handler fails.
    logger.error(`Execute Event Failed: ${e.message}`);
    throw new Error(`Execute Event Failed: ${e.message}`);
  }
}