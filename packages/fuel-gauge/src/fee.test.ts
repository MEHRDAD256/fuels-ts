import { getForcProject } from '@fuel-ts/utils/test-utils';
import { generateTestWallet } from '@fuel-ts/wallet/test-utils';
import type { BN, BaseWalletUnlocked, CoinQuantityLike, JsonAbi } from 'fuels';
import {
  BaseAssetId,
  ContractFactory,
  FUEL_NETWORK_URL,
  Predicate,
  Provider,
  ScriptTransactionRequest,
  Wallet,
  bn,
} from 'fuels';
import { join } from 'path';

describe('Fee', () => {
  const assetA: string = '0x0101010101010101010101010101010101010101010101010101010101010101';
  const assetB: string = '0x0202020202020202020202020202020202020202020202020202020202020202';

  let wallet: BaseWalletUnlocked;
  let provider: Provider;
  let minGasPrice: number;

  beforeAll(async () => {
    provider = await Provider.create(FUEL_NETWORK_URL);
    minGasPrice = provider.getGasConfig().minGasPrice.toNumber();
    wallet = await generateTestWallet(provider, [
      [1_000_000_000],
      [1_000_000_000, assetA],
      [1_000_000_000, assetB],
    ]);
  });

  const expectFeeInMarginOfError = (fee: BN, expectedFee: BN) => {
    const feeNumber = fee.toNumber();
    const expectedFeeNumber = expectedFee.toNumber();
    switch (feeNumber) {
      case expectedFeeNumber:
      case expectedFeeNumber + 1:
      case expectedFeeNumber - 1:
        return true;
      default:
        throw new Error(
          `Expected fee: '${feeNumber}' to be within margin of error: '${expectedFeeNumber - 1}-${
            expectedFeeNumber + 1
          }'`
        );
    }
  };

  const randomGasPrice = (minValue: number, maxValue: number) => {
    const randomValue = Math.floor(Math.random() * (maxValue - minValue + 1) + minValue);
    return bn(randomValue);
  };

  it('should ensure fee is properly calculated when minting and burning coins', async () => {
    const path = join(__dirname, '../fixtures/forc-projects/multi-token-contract');

    const { binHexlified, abiContents } = getForcProject<JsonAbi>(path);

    const factory = new ContractFactory(binHexlified, abiContents, wallet);
    const contract = await factory.deployContract({ gasPrice: minGasPrice });

    // minting coins
    let balanceBefore = await wallet.getBalance();

    let gasPrice = randomGasPrice(minGasPrice, 15);

    const subId = '0x4a778acfad1abc155a009dc976d2cf0db6197d3d360194d74b1fb92b96986b00';

    const {
      transactionResult: { fee: fee1 },
    } = await contract.functions.mint_coins(subId, 1_000).txParams({ gasPrice }).call();

    let balanceAfter = await wallet.getBalance();

    let balanceDiff = balanceBefore.sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee1, balanceDiff)).toBeTruthy();

    // burning coins
    balanceBefore = await wallet.getBalance();

    gasPrice = randomGasPrice(minGasPrice, 15);

    const {
      transactionResult: { fee: fee2 },
    } = await contract.functions.mint_coins(subId, 1_000).txParams({ gasPrice }).call();

    balanceAfter = await wallet.getBalance();

    balanceDiff = balanceBefore.sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee2, balanceDiff)).toBeTruthy();
  });

  it('should ensure fee is properly calculated on simple transfer transactions', async () => {
    const destination = Wallet.generate({ provider });

    const amountToTransfer = 120;
    const balanceBefore = await wallet.getBalance();

    const gasPrice = randomGasPrice(minGasPrice, 15);

    const tx = await wallet.transfer(destination.address, amountToTransfer, BaseAssetId, {
      gasPrice,
    });
    const { fee } = await tx.wait();

    const balanceAfter = await wallet.getBalance();
    const balanceDiff = balanceBefore.sub(amountToTransfer).sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee, balanceDiff)).toBeTruthy();
  });

  it('should ensure fee is properly calculated on multi transfer transactions', async () => {
    const destination1 = Wallet.generate({ provider });
    const destination2 = Wallet.generate({ provider });
    const destination3 = Wallet.generate({ provider });

    const amountToTransfer = 120;
    const gasPrice = randomGasPrice(minGasPrice, 15);
    const balanceBefore = await wallet.getBalance();

    const request = new ScriptTransactionRequest({
      gasPrice,
      gasLimit: 10000,
    });

    request.addCoinOutput(destination1.address, amountToTransfer, BaseAssetId);
    request.addCoinOutput(destination2.address, amountToTransfer, assetA);
    request.addCoinOutput(destination3.address, amountToTransfer, assetB);

    const quantities: CoinQuantityLike[] = [
      [20_000 + amountToTransfer, BaseAssetId],
      [amountToTransfer, assetA],
      [amountToTransfer, assetB],
    ];

    const resources = await wallet.getResourcesToSpend(quantities);

    request.addResources(resources);

    const tx = await wallet.sendTransaction(request);
    const { fee } = await tx.wait();

    const balanceAfter = await wallet.getBalance();
    const balanceDiff = balanceBefore.sub(amountToTransfer).sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee, balanceDiff)).toBeTruthy();
  });

  it('should ensure fee is properly calculated on a contract deploy', async () => {
    const path = join(__dirname, '../fixtures/forc-projects/multi-token-contract');

    const { binHexlified, abiContents } = getForcProject<JsonAbi>(path);

    const balanceBefore = await wallet.getBalance();

    const gasPrice = randomGasPrice(minGasPrice, 15);
    const factory = new ContractFactory(binHexlified, abiContents, wallet);
    const { transactionRequest } = factory.createTransactionRequest({ gasPrice });
    await wallet.fund(transactionRequest);

    const tx = await wallet.sendTransaction(transactionRequest);
    const { fee } = await tx.wait();

    const balanceAfter = await wallet.getBalance();
    const balanceDiff = balanceBefore.sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee, balanceDiff)).toBeTruthy();
  });

  it('should ensure fee is properly calculated on a contract call', async () => {
    const path = join(__dirname, '../fixtures/forc-projects/call-test-contract');

    const { binHexlified, abiContents } = getForcProject<JsonAbi>(path);

    const factory = new ContractFactory(binHexlified, abiContents, wallet);
    const contract = await factory.deployContract({ gasPrice: minGasPrice });

    const gasPrice = randomGasPrice(minGasPrice, 15);
    const balanceBefore = await wallet.getBalance();

    const {
      transactionResult: { fee },
    } = await contract.functions
      .sum_multparams(1, 2, 3, 4, 5)
      .txParams({
        gasPrice,
        gasLimit: 10000,
      })
      .call();

    const balanceAfter = await wallet.getBalance();
    const balanceDiff = balanceBefore.sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee, balanceDiff)).toBeTruthy();
  });

  it('should ensure fee is properly calculated a contract multi call', async () => {
    const path = join(__dirname, '../fixtures/forc-projects/call-test-contract');

    const { binHexlified, abiContents } = getForcProject<JsonAbi>(path);

    const factory = new ContractFactory(binHexlified, abiContents, wallet);
    const contract = await factory.deployContract({ gasPrice: minGasPrice });

    const gasPrice = randomGasPrice(minGasPrice, 15);
    const balanceBefore = await wallet.getBalance();

    const scope = contract
      .multiCall([
        contract.functions.sum_multparams(1, 2, 3, 4, 5),
        contract.functions.return_void(),
        contract.functions.foobar(),
        contract.functions.return_bytes(),
      ])
      .txParams({
        gasPrice,
        gasLimit: 10000,
      });

    const {
      transactionResult: { fee },
    } = await scope.call();

    const balanceAfter = await wallet.getBalance();
    const balanceDiff = balanceBefore.sub(balanceAfter);

    expect(expectFeeInMarginOfError(fee, balanceDiff)).toBeTruthy();
  });

  it('should ensure fee is properly calculated on transactions with predicate', async () => {
    const path = join(__dirname, '../fixtures/forc-projects/predicate-true');

    const { binHexlified, abiContents } = getForcProject<JsonAbi>(path);

    const predicate = new Predicate(binHexlified, provider, abiContents);

    const tx1 = await wallet.transfer(predicate.address, 1_500_000, BaseAssetId, {
      gasPrice: minGasPrice,
    });
    await tx1.wait();

    const transferAmount = 100;
    const balanceBefore = await predicate.getBalance();
    const gasPrice = randomGasPrice(minGasPrice, 9);
    const tx2 = await predicate.transfer(wallet.address, transferAmount, BaseAssetId, { gasPrice });

    const { fee } = await tx2.wait();

    const balanceAfter = await predicate.getBalance();
    const balanceDiff = balanceBefore.sub(balanceAfter).sub(transferAmount);

    expect(expectFeeInMarginOfError(fee, balanceDiff)).toBeTruthy();
  });
});
