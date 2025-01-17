"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveContractExecutionError = exports.LiveContractCreationError = exports.LiveContract = exports.DEFAULT_GAS_PER_CONTRACT_TRANSACTION = void 0;
const tslib_1 = require("tslib");
const bignumber_js_1 = require("bignumber.js");
const traverse = require("traverse");
const sdk_1 = require("@hashgraph/sdk");
const Contract_1 = require("../static/Contract");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const abi_1 = require("@ethersproject/abi");
const HContractFunctionParameters_1 = require("../HContractFunctionParameters");
const EventEmitter = require("events");
exports.DEFAULT_GAS_PER_CONTRACT_TRANSACTION = 69000;
class LiveContract extends EventEmitter {
    /**
     * Constructs a new LiveContract to be interacted with.
     *
     * @param {object} options
     * @param {Client} options.client
     * @param {Contract} options.contract
     * @param {ContractCreateTransaction} options.createContractTransaction
     */
    static newFor({ client, contract, createContractTransaction }) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (client instanceof sdk_1.Client === false ||
                contract instanceof Contract_1.Contract === false ||
                createContractTransaction instanceof sdk_1.ContractCreateTransaction === false) {
                throw new Error("We need a reference to the underlying client tranport, the contract blueprint being deployed and " +
                    "a referance to the pre-filled contract-create transaction in order to execute the transaction and create the live-contract link.");
            }
            const contractTransactionResponse = yield createContractTransaction.execute(client);
            const createdContractReceipt = yield contractTransactionResponse.getReceipt(client);
            if (createdContractReceipt.status !== sdk_1.Status.Success) {
                throw new LiveContractCreationError(createdContractReceipt.status);
            }
            return new LiveContract({
                client,
                id: createdContractReceipt.contractId,
                cInterface: contract.interface,
            });
        });
    }
    constructor({ client, id, cInterface }) {
        super();
        if (client instanceof sdk_1.Client === false ||
            id instanceof sdk_1.ContractId === false ||
            cInterface instanceof abi_1.Interface === false) {
            throw new LiveContractCreationError("In order to create a new live-contract instance we would need a Hedera Client, a ContractId and a managed Contract Interface.");
        }
        this._client = client;
        this._id = id;
        this._interface = cInterface;
        // Dinamically inject ABI function handling
        Object.values(this._interface.functions).forEach(fDescription => Object.defineProperty(this, fDescription.name, {
            enumerable: true,
            value: (function (fDescription, ...args) {
                return tslib_1.__awaiter(this, void 0, void 0, function* () {
                    const request = this._createContractRequestFor({ fDescription, args });
                    const txResponse = yield request.execute(this._client);
                    let functionResult = txResponse;
                    if (!fDescription.constant) {
                        const txRecord = yield txResponse.getRecord(this._client);
                        this._tryToProcessForEvents(txRecord);
                        if (txRecord.receipt.status !== sdk_1.Status.Success) {
                            throw new LiveContractExecutionError(`Receveid a non-successfull status message ${txRecord.receipt.status}`);
                        }
                        functionResult = txRecord.contractFunctionResult;
                    }
                    // TODO: look at txResponse.logs and txResponse.errorMessage
                    return yield this._tryExtractingResponse(functionResult, fDescription);
                });
            }).bind(this, fDescription),
            writable: false,
        }));
    }
    get id() {
        return this._id;
    }
    /**
     * Creates a contract query/call request based for the given function-description and the desired arguments (args).
     * The first argument is checked to see if it matches the constructor arguments schema and, if it does, it's used to construct the
     * actual request instance, discarding it in the process so that the remaining arguments can all be used as the actual values sent to
     * the targeted function.
     *
     * @param {object} options
     * @param {FunctionFragment} options.fDescription
     * @param {Array<Object>} options.args
     * @returns {ContractCallQuery | ContractExecuteTransaction}
     */
    _createContractRequestFor({ fDescription, args }) {
        let requestOptionsPresentInArgs = false;
        let constructorArgs = {
            contractId: this.id,
            gas: exports.DEFAULT_GAS_PER_CONTRACT_TRANSACTION
        };
        let contractRequest;
        // Try to pick up any specific constructor arguments provided at call-time such as 'gas' or 'amount' to transfer
        if (args && args.length > 0) {
            if (Number.isInteger(args[0].gas)) {
                constructorArgs.gas = args[0].gas;
                requestOptionsPresentInArgs = true;
            }
            if (!fDescription.constant) {
                if (Number.isInteger(args[0].amount)) {
                    constructorArgs.amount = args[0].amount;
                    requestOptionsPresentInArgs = true;
                }
            }
        }
        // Initialize the Hedera request-object itself passing in any additional constructor args (if provided)
        contractRequest = fDescription.constant ? new sdk_1.ContractCallQuery(constructorArgs) : new sdk_1.ContractExecuteTransaction(constructorArgs);
        // Try to inject setter-only options
        if (args && args.length > 0) {
            if (fDescription.constant) {
                // Try setting aditional Query properties
                if (args[0].maxQueryPayment instanceof sdk_1.Hbar) {
                    contractRequest.setMaxQueryPayment(args[0].maxQueryPayment);
                    requestOptionsPresentInArgs = true;
                }
                if (args[0].paymentTransactionId instanceof sdk_1.TransactionId) {
                    contractRequest.setPaymentTransactionId(args[0].paymentTransactionId);
                    requestOptionsPresentInArgs = true;
                }
                if (args[0].queryPayment instanceof sdk_1.Hbar) {
                    contractRequest.setQueryPayment(args[0].queryPayment);
                    requestOptionsPresentInArgs = true;
                }
            }
            else {
                // This is a state-changing Transaction. Try setting aditional properties as well
                if (args[0].maxTransactionFee) { // number | string | Long | BigNumber | Hbar
                    contractRequest.setMaxTransactionFee(args[0].maxTransactionFee);
                    requestOptionsPresentInArgs = true;
                }
                if (Array.isArray(args[0].nodeAccountIds)) {
                    contractRequest.setNodeAccountIds(args[0].nodeAccountIds);
                    requestOptionsPresentInArgs = true;
                }
                if (args[0].transactionId instanceof sdk_1.TransactionId) {
                    contractRequest.setTransactionId(args[0].transactionId);
                    requestOptionsPresentInArgs = true;
                }
                if (args[0].transactionMemo) { // string
                    contractRequest.setTransactionMemo(args[0].transactionMemo);
                    requestOptionsPresentInArgs = true;
                }
                if (Number.isInteger(args[0].transactionValidDuration)) {
                    contractRequest.setTransactionValidDuration(args[0].transactionValidDuration);
                    requestOptionsPresentInArgs = true;
                }
            }
        }
        // Try cleaning up arguments list if config object was provide
        if (requestOptionsPresentInArgs) {
            args = args.slice(1);
        }
        // Prepare the targeted function
        contractRequest.setFunction(fDescription.name, new HContractFunctionParameters_1.HContractFunctionParameters(fDescription, args));
        return contractRequest;
    }
    /**
     * Given a contract-request response (txResponse) and a targeted function-description, it tries to extract and prepare the caller response based on
     * the contract's output function ABI specs.
     *
     * @param {*} txResponse
     * @param {FunctionFragment} fDescription
     * @returns
     */
    _tryExtractingResponse(txResponse, fDescription) {
        const EthersBigNumber = require('@ethersproject/bignumber').BigNumber;
        let fResponse = undefined;
        const fResult = this._interface.decodeFunctionResult(fDescription, txResponse.asBytes());
        const fResultKeys = Object.keys(fResult).filter(evDataKey => isNaN(evDataKey));
        if (fDescription.outputs && fDescription.outputs.length !== 0) {
            if (fResultKeys.length === fDescription.outputs.length) {
                // A named object can be returned since all the outputs are named
                fResponse = fResultKeys.map(namedfDataKey => ({ [namedfDataKey]: fResult[namedfDataKey] }))
                    .reduce((p, c) => (Object.assign(Object.assign({}, p), c)), {});
            }
            else if (fDescription.outputs.length > 1) {
                fResponse = [...fResult];
            }
            else {
                fResponse = fResult[0];
            }
            // Map all Ethers' BigNumber to the Hedera-used, bignumber.js equivalent
            fResponse = traverse(fResponse).map(function (x) {
                if (EthersBigNumber.isBigNumber(x)) {
                    this.update(new bignumber_js_1.BigNumber(x.toString()));
                }
            });
        }
        return fResponse;
    }
    /**
     * Given the Record of a transaction, we try to see if there have been any events emitted and, if so, we re-emit them on the live-contract instance.
     * @param {TransactionRecord} txRecord
     */
    _tryToProcessForEvents(txRecord) {
        txRecord.contractFunctionResult.logs.forEach(recordLog => {
            const data = recordLog.data.length === 0 ? new Uint8Array() : "0x" + recordLog.data.toString('hex');
            const topics = recordLog.topics.map(topic => "0x" + topic.toString('hex'));
            let logDescription;
            try {
                logDescription = this._interface.parseLog({ data, topics });
            }
            catch (e) {
                // No-op
            }
            if (!logDescription || this.listenerCount(logDescription.name) === 0) {
                // No one is interested in this event. Skip
                return;
            }
            const decodedEventObject = Object.keys(logDescription.args)
                .filter(evDataKey => isNaN(evDataKey))
                .map(namedEvDataKey => ({ [namedEvDataKey]: logDescription.args[namedEvDataKey] }))
                .reduce((p, c) => (Object.assign(Object.assign({}, p), c)), {});
            try {
                this.emit(logDescription.name, decodedEventObject);
            }
            catch (e) {
                if (process.env.NODE_ENV === 'test') {
                    // We re-interpret and throw it so that any tests running will be aware of it
                    throw new Error(`The event-emitter handle '${logDescription.name}' failed to execute with the following reason: ${e.message}`);
                }
                // otherwise, it's a No-op
            }
        });
    }
}
exports.LiveContract = LiveContract;
class LiveContractCreationError extends Error {
    /**
     * @param {Status} status
     */
    constructor(status) {
        super(`There was an issue (status ${status}) creating the live-contract link.`);
    }
}
exports.LiveContractCreationError = LiveContractCreationError;
class LiveContractExecutionError extends Error {
    constructor(msg) {
        super(msg);
    }
}
exports.LiveContractExecutionError = LiveContractExecutionError;
//# sourceMappingURL=LiveContract.js.map