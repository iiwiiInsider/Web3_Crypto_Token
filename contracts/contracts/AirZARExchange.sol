// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./AirZAR.sol";

contract AirZARExchange is Ownable {
    struct TokenConfig {
        bool supported;
        uint256 zarPerToken; // 1e18 precision
    }

    AirZAR public immutable airzar;
    address public treasury;
    uint256 public feeBps = 50; // 0.5%

    mapping(address => TokenConfig) public tokenConfig;

    event TokenConfigured(address token, bool supported, uint256 zarPerToken);
    event TreasuryUpdated(address treasury);
    event FeeUpdated(uint256 feeBps);
    event Buy(address indexed user, address indexed token, uint256 tokenIn, uint256 airzarOut, uint256 fee);
    event Sell(address indexed user, address indexed token, uint256 airzarIn, uint256 tokenOut, uint256 fee);

    constructor(address airzar_, address treasury_) Ownable(msg.sender) {
        airzar = AirZAR(airzar_);
        treasury = treasury_;
    }

    function setTokenConfig(address token, bool supported, uint256 zarPerToken) external onlyOwner {
        tokenConfig[token] = TokenConfig({supported: supported, zarPerToken: zarPerToken});
        emit TokenConfigured(token, supported, zarPerToken);
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setFeeBps(uint256 feeBps_) external onlyOwner {
        require(feeBps_ <= 200, "fee too high");
        feeBps = feeBps_;
        emit FeeUpdated(feeBps_);
    }

    function buy(address token, uint256 tokenAmount) external {
        TokenConfig memory cfg = tokenConfig[token];
        require(cfg.supported, "token not supported");
        require(tokenAmount > 0, "amount zero");

        IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);

        uint256 fee = (tokenAmount * feeBps) / 10000;
        uint256 net = tokenAmount - fee;

        if (fee > 0) {
            IERC20(token).transfer(treasury, fee);
        }

        uint256 airzarAmount = (net * cfg.zarPerToken) / 1e18;
        airzar.mint(msg.sender, airzarAmount);

        emit Buy(msg.sender, token, tokenAmount, airzarAmount, fee);
    }

    function sell(address token, uint256 airzarAmount) external {
        TokenConfig memory cfg = tokenConfig[token];
        require(cfg.supported, "token not supported");
        require(airzarAmount > 0, "amount zero");

        uint256 tokenAmount = (airzarAmount * 1e18) / cfg.zarPerToken;
        uint256 fee = (tokenAmount * feeBps) / 10000;
        uint256 net = tokenAmount - fee;

        airzar.burnFrom(msg.sender, airzarAmount);

        if (fee > 0) {
            IERC20(token).transfer(treasury, fee);
        }
        IERC20(token).transfer(msg.sender, net);

        emit Sell(msg.sender, token, airzarAmount, net, fee);
    }

    function fundLiquidity(address token, uint256 amount) external onlyOwner {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}
