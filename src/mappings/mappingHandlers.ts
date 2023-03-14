import { Message } from "../types";
import { CosmosMessage, CosmosEvent } from "@subql/types-cosmos";
import { CODE_ID } from "../utils";

//Only allow relevant codeId(s) to pass through
const isCorrectCodeId = (msg: CosmosMessage) => {
  return (msg.msg.decodedMsg.codeId.low && msg.msg.decodedMsg.codeId.low in CODE_ID)
}

//save data to Message entity in db
export const handleMessage = async (msg: CosmosMessage): Promise<void> => {
  if (!isCorrectCodeId(msg)) return;
  const messageRecord = Message.create({
    id: `${msg.tx.block.block.id}-${msg.tx.idx}`,
    blockHeight: BigInt(msg.tx.block.block.header.height),
    txHash: msg.tx.hash,
    name: msg.msg.decodedMsg.msg.name,
    symbol: msg.msg.decodedMsg.msg.symbol,
    decimals: msg.msg.decodedMsg.msg.decimals,
  });
  await messageRecord.save();
}

export const handleEvent = async (event: CosmosEvent): Promise<void> => {
  /* const record = new EventEntity(
    `${event.tx.tx.txhash}-${event.msg.idx}-${event.idx}`
  );
  record.blockHeight = BigInt(event.block.block.block.header.height);
  record.txHash = event.tx.tx.txhash;
  await record.save(); */
  /* logger.info(JSON.stringify(event)); */
  logger.info("there is info here")
}