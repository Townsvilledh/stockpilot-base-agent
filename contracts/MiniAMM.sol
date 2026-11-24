// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Mini {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
}

/// @title MiniAMM — a minimal constant-product AMM for mock stock / USDC pools.
/// @notice One pool per mock stock token against a single mock USDC. 0.3% swap
///         fee, Uniswap-V2-style math on raw units. Built for the StockPilot
///         testnet demo: small, readable, and fully on-chain so every agent
///         trade is a real transaction with a real price impact.
contract MiniAMM {
    address public immutable usdc;
    uint8 public immutable usdcDecimals;

    struct Pool {
        uint256 stockReserve;
        uint256 usdcReserve;
        uint8 stockDecimals;
        bool exists;
    }

    mapping(address => Pool) public pools;

    event LiquidityAdded(address indexed token, uint256 stockAmount, uint256 usdcAmount);
    event Swap(
        address indexed sender,
        address indexed token,
        bool usdcIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 spotPriceAfter1e18
    );

    constructor(address _usdc) {
        usdc = _usdc;
        usdcDecimals = IERC20Mini(_usdc).decimals();
    }

    function addLiquidity(address token, uint256 stockAmount, uint256 usdcAmount) external {
        require(stockAmount > 0 && usdcAmount > 0, "zero");
        Pool storage p = pools[token];
        if (!p.exists) {
            p.stockDecimals = IERC20Mini(token).decimals();
            p.exists = true;
        }
        require(IERC20Mini(token).transferFrom(msg.sender, address(this), stockAmount), "stock tf");
        require(IERC20Mini(usdc).transferFrom(msg.sender, address(this), usdcAmount), "usdc tf");
        p.stockReserve += stockAmount;
        p.usdcReserve += usdcAmount;
        emit LiquidityAdded(token, stockAmount, usdcAmount);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "bad amounts");
        uint256 inWithFee = amountIn * 997;
        return (inWithFee * reserveOut) / (reserveIn * 1000 + inWithFee);
    }

    /// @notice Spot price: whole USDC per whole stock token, scaled 1e18.
    function spotPrice1e18(address token) public view returns (uint256) {
        Pool storage p = pools[token];
        require(p.exists && p.stockReserve > 0, "no pool");
        // price = (usdcReserve / 10^usdcDec) / (stockReserve / 10^stockDec)
        // price1e18 = usdcReserve * 10^(stockDec - usdcDec + 18) / stockReserve
        uint256 exp = uint256(p.stockDecimals) + 18 - uint256(usdcDecimals);
        return (p.usdcReserve * (10 ** exp)) / p.stockReserve;
    }

    function swapUsdcForStock(address token, uint256 usdcIn, uint256 minOut) external returns (uint256 out) {
        Pool storage p = pools[token];
        require(p.exists, "no pool");
        out = getAmountOut(usdcIn, p.usdcReserve, p.stockReserve);
        require(out >= minOut && out < p.stockReserve, "slippage");
        require(IERC20Mini(usdc).transferFrom(msg.sender, address(this), usdcIn), "usdc tf");
        p.usdcReserve += usdcIn;
        p.stockReserve -= out;
        require(IERC20Mini(token).transfer(msg.sender, out), "stock t");
        emit Swap(msg.sender, token, true, usdcIn, out, spotPrice1e18(token));
    }

    function swapStockForUsdc(address token, uint256 stockIn, uint256 minOut) external returns (uint256 out) {
        Pool storage p = pools[token];
        require(p.exists, "no pool");
        out = getAmountOut(stockIn, p.stockReserve, p.usdcReserve);
        require(out >= minOut && out < p.usdcReserve, "slippage");
        require(IERC20Mini(token).transferFrom(msg.sender, address(this), stockIn), "stock tf");
        p.stockReserve += stockIn;
        p.usdcReserve -= out;
        require(IERC20Mini(usdc).transfer(msg.sender, out), "usdc t");
        emit Swap(msg.sender, token, false, stockIn, out, spotPrice1e18(token));
    }
}
