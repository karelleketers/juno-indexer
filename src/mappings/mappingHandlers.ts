import { Message } from "../types";
import { CosmosMessage } from "@subql/types-cosmos";

//Only allow relevant codeId(s) to pass through
const isCorrectCodeId = (msg: CosmosMessage) => {
  return (msg.msg.decodedMsg.codeId.low &&  msg.msg.decodedMsg.codeId.low === 1)
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