// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReferenceOracle — real-world reference prices for mock stocks.
/// @notice Stores USD reference prices (scaled 1e18) for the real tickers the
///         mock tokens shadow (AAPL, TSLA, NVDA). Prices are snapshotted from
///         public market data by the keeper (deployer) — on testnet this is a
///         deliberately simple, transparent oracle: every update is an
///         on-chain transaction with an event, so the agent's reference is
///         fully auditable. The StockPilot agent trades AMM prices toward
///         these reference prices.
contract ReferenceOracle {
    address public keeper;
    mapping(string => uint256) private _price1e18;
    mapping(string => uint256) public updatedAt;

    event PriceSet(string symbol, uint256 price1e18, uint256 timestamp);
    event KeeperChanged(address indexed oldKeeper, address indexed newKeeper);

    constructor() {
        keeper = msg.sender;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper, "not keeper");
        _;
    }

    function setKeeper(address newKeeper) external onlyKeeper {
        emit KeeperChanged(keeper, newKeeper);
        keeper = newKeeper;
    }

    /// @param price1e18 USD price scaled by 1e18 (e.g. 353.57 USD -> 353.57e18)
    function setPrice(string calldata symbol, uint256 price1e18) external onlyKeeper {
        require(price1e18 > 0, "zero price");
        _price1e18[symbol] = price1e18;
        updatedAt[symbol] = block.timestamp;
        emit PriceSet(symbol, price1e18, block.timestamp);
    }

    function getPrice(string calldata symbol) external view returns (uint256) {
        uint256 p = _price1e18[symbol];
        require(p > 0, "no price");
        return p;
    }
}
