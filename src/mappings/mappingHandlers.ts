import { Token, TransferEvent } from "../types";
import { CosmosEvent } from "@subql/types-cosmos";
import { CODE_ID } from "../utils";

//Only allow relevant codeId(s) to pass through
const isCorrectCodeId = (ev: CosmosEvent) => {
  return (ev.msg.msg.decodedMsg.codeId.low && ev.msg.msg.decodedMsg.codeId.low in CODE_ID)
}

const verifyToken = async (address: string): Promise<Token | undefined> => {
  try { const token = await Token.getByAddress(address);
  if (!token) return;
  token.transferEventCount += 1;
  await token.save();
  return token;
  } catch(error) {
    logger.error
  }
}

//save data to Token entity in db
export const handleInstantiateEvent = async (event: CosmosEvent): Promise<void> => {
  try { 
  if (!isCorrectCodeId(event)) return;
  const contractAddress = event.event.type === "instantiate" && event.event.attributes.find(attribute => attribute.key === "_contract_address");

  const tokenRecord = Token.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}`,
      address: contractAddress.value,
      decimals: event.msg.msg.decodedMsg.msg.decimals,
      name: event.msg.msg.decodedMsg.msg.name,
      symbol: event.msg.msg.decodedMsg.msg.symbol,
      source: event.msg.msg.decodedMsg.sender,
      transferEventCount: 0,
      totalSupply: "0",
      totalTransferred: "0"
  });
  await tokenRecord.save();
  } catch (error) {
    logger.error
  }
}

//try catch
export const handleExecuteEvent = async (event: CosmosEvent): Promise<void> => {
  try { 
    const address = event.msg.msg.decodedMsg.contract ?? "";
    const token = await verifyToken(address);
    if (!token) return;
    const transferRecord = TransferEvent.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}`,
      //@ts-ignore
      token: token,
      amount: event.msg.msg.decodedMsg.msg.transfer.amount,
      sender: event.msg.msg.decodedMsg.sender,
      destination: event.msg.msg.decodedMsg.msg.transfer.recipient,
      block: event.msg.block.block.header.height,
      timestamp: event.msg.block.block.header.time,
      transaction: event.msg.tx.hash,
    });
    await transferRecord.save();
  } catch(error) {
    logger.error
  }
}