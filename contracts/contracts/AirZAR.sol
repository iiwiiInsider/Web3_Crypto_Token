// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AirZAR is ERC20, Ownable {
    constructor(address owner_) ERC20("AirZAR", "AZAR") Ownable(owner_) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) external onlyOwner {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
}
