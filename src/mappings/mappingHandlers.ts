import { Account, Module, ModuleSnapshot, Asset, AccountModule, TransferEvent, ModuleExecution } from "../types";
import { CosmosEvent } from "@subql/types-cosmos";
import { ModuleParams } from "../interfaces/interfaces";
import { ADDRESSES } from "../enums";

/**
 * Verifies the existence of a module and updates it if it already exists
 * @param {CosmosEvent} event - The Cosmos event containing information about the module.
 * @returns {Promise<void>} - A promise that resolves when the module has been saved to the database.
 */
const verifyModule = async (event: CosmosEvent): Promise<void> => {
  try {
    // Extract the modules to add from the event message
    const modulesToAdd = event.msg.msg.decodedMsg.msg.add_modules.modules;

    // Loop through the modules to add
    modulesToAdd.map(async moduleToAdd => {
      // Extract the module and module type information
      const module = moduleToAdd[0];
      const moduleType = moduleToAdd[1];

      // Extract the module type (e.g. 'wasm') from the module type object
      const type = Object.keys(moduleType)[0];

      // Generate a unique ID for the module using the block ID, transaction index, and module name
      const id = `${event.tx.block.block.id}-${event.tx.idx}-${module.name}`;

      // Attempt to retrieve an existing module with the same ID
      const existingModule = await Module.get(id);

      // If no existing module was found, create a new one
      if (!existingModule) {
        const moduleParams = { 
          namespace: module.namespace, 
          name: module.name, 
          version: module.version.version, 
          type, 
          address: moduleType[type]
        };
        await createModule(event, moduleParams);
        return;
      }

      // Update the existing module with the new version and transaction information
      existingModule.version = module.version.version;
      existingModule.vcAddress = event.msg.msg.decodedMsg.contract;
      existingModule.timestamp = event.msg.block.block.header.time;
      existingModule.txHash = event.msg.tx.hash;

      // Save the updated module to the database
      await existingModule.save();

      // Log success message
      logger.info(`Updated module ${event.msg.tx.hash} successfully saved to db`);
    });
  } catch(e) {
    // Log and throw an error if the handler fails.
    logger.error(`Verify Module ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Verify Module ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}

const verifyAddress = async (address: string): Promise<boolean> => {
  const manager = await Account.getByManager(address);
  const proxy = await Account.getByProxy(address);

  const verified = manager ?? proxy;

  return !!verified;
}

/**
 * Creates a new module in the database.
 * @param {CosmosEvent} event - The Cosmos event containing information about the module.
 * @param {ModuleParams} moduleParams - The parameters for the new module.
 * @returns {Promise<void>} - A promise that resolves when the new module has been saved to the database.
 */
export const createModule = async (event: CosmosEvent, moduleParams: ModuleParams): Promise<void> => {
  try {
    const { sender, contract } = event.msg.msg.decodedMsg;

    // Create a new module object with the provided parameters and other data from the Cosmos event.
    const module = Module.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}-${moduleParams.name}`,
      namespace: moduleParams.namespace,
      sender,
      name: moduleParams.name,
      version: moduleParams.version,
      type: moduleParams.type,
      address: moduleParams.address,
      vcAddress: contract,
      timestamp: event.msg.block.block.header.time,
      txHash: event.msg.tx.hash,
    });

    // Save the new module to the database.
    await module.save();

    // Log success message
    logger.info(`Module ${event.msg.tx.hash} successfully saved to db`);

  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Create Module ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Create Module ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}

/**
 * Creates a new module snapshot in the database.
 * @param {CosmosEvent} event - The event triggering the creation of the module snapshot.
 * @return {Promise<void>} - Promise that resolves when the module snapshot has been created.
 */
export const createModuleSnapshot = async (event: CosmosEvent): Promise<void> => {
  try {
    const { sender, contract, msg } = event.msg.msg.decodedMsg;

    const modulesToAdd = msg.add_modules.modules;

    // Loop through the modules to add
    modulesToAdd.map(async moduleToAdd => {
      const module = moduleToAdd[0];
      const moduleType = moduleToAdd[1];
      const type = Object.keys(moduleType)[0];
      const timestamp = event.msg.block.block.header.time;
      const id = `${event.tx.block.block.id}-${event.tx.idx}-${module.name}-${timestamp}`;

      // Create a new module snapshot object with the provided parameters and other data from the Cosmos event.
      const moduleSnapshot = ModuleSnapshot.create({
        id,
        namespace: module.namespace,
        sender,
        name: module.name,
        version: module.version.version,
        type,
        address: moduleType[type],
        vcAddress: contract,
        timestamp,
        txHash: event.msg.tx.hash,
      });

      // Save the new module snapshot to the database.
      await moduleSnapshot.save();

      // Log success message
      logger.info(`Module snapshot ${event.msg.tx.hash} successfully saved to db`);
    })
  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Verify Module ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Verify Module ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}

export const handleAccountEvents = async (event: CosmosEvent): Promise<void> => {
  try {
    // Get the contract address, sender, message, and funds from the decoded message
    const { sender, contract, msg, funds } = event.msg.msg.decodedMsg;

    //only allow events from approved contracts
    //! DON'T BOTHER WITH THIS UNLESS ADDRESSES ARE FIXED, WHICH THEY CURRENTLY ARE NOT AND IT'S PREVENTING THE DB FROM BEING POPULATED. THIS WILL GIVE YOU HEADACHES. I MEAN IT.
    //if (!(contract === ADDRESSES.ACCOUNT_FACTORY)) return;

    // Get the description, governance, and name from the create_account object
    const { description, governance, name } = msg.create_account;
    /* const { description, governance, name } = msg.create_os; */

    // Get the relevant attributes from the wasm-abstract event (if it exists)
    const abstractEvents = (event.log.events.find(event => event.type === "wasm-abstract"))?.attributes;

    // Create an Account object with the relevant fields
    const account = Account.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}`,
      address: contract,
      abstractId: abstractEvents.find(attr => attr.key === "account_id")?.value,
      creator: sender,
      name,
      owner: governance.Monarchy.monarch,
      manager: abstractEvents.find(attr => attr.key === "manager_address")?.value,
      proxy: abstractEvents.find(attr => attr.key === "proxy_address")?.value,
      admin: abstractEvents.find(attr => attr.key === "admin")?.value,
      description: description && description,
      governanceType: (Object.keys(governance))[0].toLowerCase(),
      fundsDenom: funds?.[0]?.denom ?? null,
      fundsAmount: funds?.[0]?.amount ?? null,
      timestamp: event.msg.block.block.header.time,
      txHash: event.msg.tx.hash,
    });

    // Save the Account object to the database
    await account.save();

    // Log success message
    logger.info(JSON.stringify(`Account ${event.msg.tx.hash} successfully saved to db`));
  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Execute Account Event ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Execute Account Event ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}

/**
 * Handles adding an abstract module by verifying the module and creating a snapshot of it.
 * @param {CosmosEvent} event - The Cosmos event object containing data about the transaction.
 * @return {Promise<void>} - Promise that resolves when the creation of a module has been handled.
 */
export const handleAbstractModuleEvents = async (event: CosmosEvent): Promise<void> => {
  try {

    const { contract } = event.msg.msg.decodedMsg

    //only allow events from approved contracts
    //! DON'T BOTHER WITH THIS UNLESS ADDRESSES ARE FIXED, WHICH THEY CURRENTLY ARE NOT AND IT'S PREVENTING THE DB FROM BEING POPULATED. THIS WILL GIVE YOU HEADACHES. I MEAN IT.
    //if (!(contract === ADDRESSES.VERSION_CONTROL)) return;

    // Verify the module before adding it
    await verifyModule(event);
    // Create a snapshot of the module
    await createModuleSnapshot(event);

  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Abstract Module ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Abstract Module ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}

/**
 * This function handles an asset ANS update event by parsing the decoded message, extracting the relevant information,
 * and storing the asset information in the database.
 * @param {CosmosEvent} event - the Cosmos event object containing the asset update event data
 * @returns {Promise<void>} - Promise that resolves when the creation of an Asset has been handled.
 */
export const handleAssetANSEvents = async (event: CosmosEvent): Promise<void> => {
  try {
    
    // Get the sender, contract address, and decoded message from the event object
    const { sender, contract, msg } = event.msg.msg.decodedMsg;

    //only allow events from approved contracts
    //! DON'T BOTHER WITH THIS UNLESS ADDRESSES ARE FIXED, WHICH THEY CURRENTLY ARE NOT AND IT'S PREVENTING THE DB FROM BEING POPULATED. THIS WILL GIVE YOU HEADACHES. I MEAN IT.
    //if (!(contract === ADDRESSES.ANS_HOST)) return;

    // Extract the list of assets to add from the decoded message and loop through each one
    const assetsToAdd = msg.update_asset_addresses.to_add;
    assetsToAdd.map(async assetToAdd => {
      // Parse the asset source and name from the assetToAdd string
      const assetToAddArr = (assetToAdd[0]).split(">");
      const source = assetToAddArr[0];
      const name = assetToAddArr[1];

      // Parse the asset type and address from the assetToAdd object
      const type = Object.keys(assetToAdd[1])[0];
      const address = assetToAdd[1][type];

      // Create an Asset object with the extracted information
      const asset = Asset.create({
        id: `${event.tx.block.block.id}-${event.tx.idx}`,
        sender,
        source,
        name,
        type,
        address,
        ansHost: contract,
        timestamp: event.msg.block.block.header.time,
        txHash: event.msg.tx.hash,
      });

      // Save the asset to the database
      await asset.save();

      // Log success message
      logger.info(JSON.stringify(`Asset ${event.msg.tx.hash} successfully saved to db`));
    })
  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Execute ANS Event ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Execute ANS Event ${event.msg.tx.hash} Failed: ${e.message}`);
  }
  
}

/**
 * Handles installing a module on an account.
 * @param {CosmosEvent} event - The Cosmos event object containing data about the transaction.
 * @return {Promise<void>} - Promise that resolves when the event has been handled.
 */
export const handleModuleEvents = async (event: CosmosEvent): Promise<void> => {
  try {
    // Extract relevant data from the event message.
    const { contract, sender, msg } = event.msg.msg.decodedMsg;

    // Retrieve the account associated with the contract manager.
    const account = await Account.getByManager(contract);

    // If no account is found, exit.
    if (!account) return;

    // Find the module address in the event logs, if it exists. Bit hacky here, but it takes the value associated with the attribute key 'module' starting with 'juno'. 
    const moduleAddress = event.log.events.find(event =>
      event.type === "wasm-abstract" && event.attributes.some(attr =>
        attr.key === "module"
      )
    )?.attributes.find(attr =>
      (attr.key === "module" && attr.value.startsWith('juno'))
    )?.value;

    // Extract the module data from the event message.
    const module = msg.install_module.module;
    
    // Create a new AccountModule object with the extracted data.
    const accountModule = AccountModule.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}-${moduleAddress}`,
      address: moduleAddress,
      name: module.name,
      namespace: module.namespace,
      version: module.version,
      manager: contract,
      account: account.address,
      vcAddress: "",
      sender,
      txHash: event.msg.tx.hash,
      timestamp: event.msg.block.block.header.time,
    });

    // Save the AccountModule object to the database.
    await accountModule.save();

    // Log success message
    logger.info(JSON.stringify(`AccountModule ${event.msg.tx.hash} successfully saved to db`));

  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Handle Installed Account Module ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Handle Installed Account Module ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}


/**
 * Handles any tranfer on an account.
 * @param {CosmosEvent} event - The Cosmos event object containing data about the transfer.
 * @return {Promise<void>} - Promise that resolves when the event has been handled.
 */
export const handleTransferEvent = async (event: CosmosEvent): Promise<void> => {
  try {
  
    const { contract, msg, sender } = event.msg.msg.decodedMsg;
    const { height: block, time: timestamp } = event.msg.block.block.header
    const amount = msg.transfer?.amount ?? 0;
    const destination = msg.transfer.recipient;

    const senderVerification = await verifyAddress(sender);
    const destinationVerification = await verifyAddress(destination);

    if (!(senderVerification) && !(destinationVerification)) return;

    // Create a new TransferEvent object with the extracted data.
    const transferEvent = TransferEvent.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}-${event.msg.tx.hash}`,
      token: contract,
      amount,
      sender,
      destination,
      block,
      txHash: event.msg.tx.hash,
      timestamp,
    });

    // Save the Transfer Event object to the database.
    await transferEvent.save();

    // Log success message
    logger.info(JSON.stringify(`TransferEvent ${event.msg.tx.hash} successfully saved to db`));

  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Handle Transfer Event ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Handle Transfer Event ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}

/**
 * Handles any execution on an Abstract Module.
 * @param {CosmosEvent} event - The Cosmos event object containing data about the transfer.
 * @return {Promise<void>} - Promise that resolves when the event has been handled.
 */
export const handleExecOnModuleEvent = async (event: CosmosEvent): Promise<void> => {
  try {
  
    const { contract, msg } = event.msg.msg.decodedMsg;
    const moduleId = msg.exec_on_module.exec_msg.module_id;

    const verification = await verifyAddress(contract);

    if (!verification) return;

    // Create a new TransferEvent object with the extracted data.
    const moduleExecution = ModuleExecution.create({
      id: `${event.tx.block.block.id}-${event.tx.idx}-${event.msg.tx.hash}`,
      address: contract,
      moduleId,
      txHash: event.msg.tx.hash,
      timestamp: event.msg.block.block.header.time,
    });

    // Save the Module Execution object to the database.
    await moduleExecution.save();
    
    //  Log success message
    logger.info(JSON.stringify(`ModuleExecutionEvent ${event.msg.tx.hash} successfully saved to db`));

  } catch (e) {
    // Log and throw an error if the handler fails.
    logger.error(`Handle Module Execution Event ${event.msg.tx.hash} Failed: ${e.message}`);
    throw new Error(`Handle Module Execution Event ${event.msg.tx.hash} Failed: ${e.message}`);
  }
}