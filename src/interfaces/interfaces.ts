import { TransferEvent } from "../types";

export interface AccountParams {
    tokenId: string
    tokenAddress: string
    transfer: TransferEvent
}