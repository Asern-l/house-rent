// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RentalChain - 区块链租房"信源链"智能合约
 * @notice 房源存证、电子合同存证、押金托管与结算
 */
contract RentalChain {
    // ============ 枚举 ============

    enum DepositStatus { None, Paid, Refunding, Refunded, PartiallyRefunded, Disputed }

    // ============ 结构体 ============

    struct ListingRecord {
        string listingId;
        address landlord;
        uint256 aiScore;
        bytes32[] imageHashes;
        uint256 createdAt;
        bool exists;
    }

    struct ContractRecord {
        string contractId;
        string listingId;
        bytes32 contractHash;
        address tenant;
        address landlord;
        uint256 createdAt;
        bool exists;
    }

    struct DepositRecord {
        string contractId;
        address tenant;
        address landlord;
        uint256 amount;
        DepositStatus status;
        uint256 paidAt;
        uint256 deductionAmount;
        string deductionReason;
        bool exists;
    }

    // ============ 状态变量 ============

    address public owner;

    // listingId => ListingRecord
    mapping(string => ListingRecord) public listings;
    string[] private _allListingIds;

    // contractId => ContractRecord
    mapping(string => ContractRecord) public contracts;
    string[] private _allContractIds;

    // contractId => DepositRecord
    mapping(string => DepositRecord) public deposits;

    // ============ 事件 ============

    event ListingStored(
        string indexed listingId,
        address indexed landlord,
        uint256 aiScore,
        bytes32[] imageHashes,
        uint256 timestamp
    );

    event ContractStored(
        string indexed contractId,
        string indexed listingId,
        bytes32 contractHash,
        address indexed tenant,
        address landlord,
        uint256 timestamp
    );

    event DepositPaid(
        string indexed contractId,
        address indexed tenant,
        uint256 amount,
        uint256 timestamp
    );

    event RefundRequested(
        string indexed contractId,
        address indexed tenant,
        uint256 timestamp
    );

    event RefundConfirmed(
        string indexed contractId,
        uint256 amount,
        uint256 timestamp
    );

    event DeductionProposed(
        string indexed contractId,
        uint256 amount,
        string reason,
        uint256 timestamp
    );

    event DeductionAccepted(
        string indexed contractId,
        uint256 tenantAmount,
        uint256 landlordAmount,
        uint256 timestamp
    );

    event DepositDisputed(
        string indexed contractId,
        address indexed initiator,
        uint256 timestamp
    );

    event DepositResolved(
        string indexed contractId,
        bool toTenant,
        uint256 timestamp
    );

    // ============ 修饰符 ============

    modifier onlyOwner() {
        require(msg.sender == owner, unicode"只有合约拥有者可以调用");
        _;
    }

    // ============ 构造函数 ============

    constructor() {
        owner = msg.sender;
    }

    // ============ 房源存证 ============

    function storeListing(
        string calldata _listingId,
        uint256 _aiScore,
        bytes32[] calldata _imageHashes
    ) external {
        require(!listings[_listingId].exists, unicode"房源ID已存在");

        ListingRecord storage record = listings[_listingId];
        record.listingId = _listingId;
        record.landlord = msg.sender;
        record.aiScore = _aiScore;
        record.imageHashes = _imageHashes;
        record.createdAt = block.timestamp;
        record.exists = true;

        _allListingIds.push(_listingId);

        emit ListingStored(_listingId, msg.sender, _aiScore, _imageHashes, block.timestamp);
    }

    // ============ 合同存证 ============

    function storeContract(
        string calldata _contractId,
        string calldata _listingId,
        bytes32 _contractHash,
        address _tenant,
        address _landlord
    ) external {
        require(!contracts[_contractId].exists, unicode"合同ID已存在");

        ContractRecord storage record = contracts[_contractId];
        record.contractId = _contractId;
        record.listingId = _listingId;
        record.contractHash = _contractHash;
        record.tenant = _tenant;
        record.landlord = _landlord;
        record.createdAt = block.timestamp;
        record.exists = true;

        _allContractIds.push(_contractId);

        emit ContractStored(_contractId, _listingId, _contractHash, _tenant, _landlord, block.timestamp);
    }

    // ============ 押金管理 ============

    function payDeposit(string calldata _contractId) external payable {
        require(contracts[_contractId].exists, unicode"合同不存在");
        require(msg.sender == contracts[_contractId].tenant, unicode"只有租客可以支付押金");
        require(!deposits[_contractId].exists, unicode"押金已支付");
        require(msg.value > 0, unicode"押金金额必须大于0");

        ContractRecord storage cr = contracts[_contractId];

        DepositRecord storage dep = deposits[_contractId];
        dep.contractId = _contractId;
        dep.tenant = cr.tenant;
        dep.landlord = cr.landlord;
        dep.amount = msg.value;
        dep.status = DepositStatus.Paid;
        dep.paidAt = block.timestamp;
        dep.exists = true;

        emit DepositPaid(_contractId, cr.tenant, msg.value, block.timestamp);
    }

    function requestRefund(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.tenant, unicode"只有租客可以发起退款");
        require(dep.status == DepositStatus.Paid, unicode"押金状态错误");

        dep.status = DepositStatus.Refunding;

        emit RefundRequested(_contractId, msg.sender, block.timestamp);
    }

    function confirmRefund(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.landlord, unicode"只有房东可以确认退款");
        require(dep.status == DepositStatus.Refunding, unicode"押金未在退款流程中");

        dep.status = DepositStatus.Refunded;
        uint256 amount = dep.amount;

        payable(dep.tenant).transfer(amount);

        emit RefundConfirmed(_contractId, amount, block.timestamp);
    }

    function proposeDeduction(
        string calldata _contractId,
        uint256 _amount,
        string calldata _reason
    ) external {
        require(deposits[_contractId].exists, unicode"押金不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.landlord, unicode"只有房东可以提出扣款");
        require(dep.status == DepositStatus.Refunding, unicode"押金未在退款流程中");
        require(_amount > 0 && _amount <= dep.amount, unicode"扣款金额不合法");

        dep.deductionAmount = _amount;
        dep.deductionReason = _reason;

        emit DeductionProposed(_contractId, _amount, _reason, block.timestamp);
    }

    function acceptDeduction(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.tenant, unicode"只有租客可以接受扣款");
        require(dep.deductionAmount > 0, unicode"未提出扣款方案");
        require(dep.status == DepositStatus.Refunding, unicode"押金状态错误");

        dep.status = DepositStatus.PartiallyRefunded;

        uint256 toTenant = dep.amount - dep.deductionAmount;
        uint256 toLandlord = dep.deductionAmount;

        if (toTenant > 0) {
            payable(dep.tenant).transfer(toTenant);
        }
        payable(dep.landlord).transfer(toLandlord);

        emit DeductionAccepted(_contractId, toTenant, toLandlord, block.timestamp);
    }

    function disputeDeposit(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(
            msg.sender == dep.tenant || msg.sender == dep.landlord,
            unicode"只有租客或房东可以发起纠纷"
        );
        require(
            dep.status == DepositStatus.Refunding,
            unicode"押金未在退款流程中"
        );

        dep.status = DepositStatus.Disputed;

        emit DepositDisputed(_contractId, msg.sender, block.timestamp);
    }

    function resolveDeposit(string calldata _contractId, bool _toTenant) external onlyOwner {
        require(deposits[_contractId].exists, unicode"押金不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(dep.status == DepositStatus.Disputed, unicode"押金未处于纠纷状态");

        if (_toTenant) {
            dep.status = DepositStatus.Refunded;
            payable(dep.tenant).transfer(dep.amount);
        } else {
            dep.status = DepositStatus.PartiallyRefunded;
            payable(dep.landlord).transfer(dep.amount);
        }

        emit DepositResolved(_contractId, _toTenant, block.timestamp);
    }

    // ============ 租金支付记录 ============

    function recordRentPayment(
        string calldata _contractId,
        address _tenant,
        address _landlord,
        uint256 _amount,
        string calldata _alipayOrderNo
    ) external onlyOwner {
        // 仅存证：记录支付事实
        emit RentReceipt(_contractId, _tenant, _landlord, _amount, _alipayOrderNo, block.timestamp);
    }

    event RentReceipt(
        string indexed contractId,
        address indexed tenant,
        address indexed landlord,
        uint256 amount,
        string alipayOrderNo,
        uint256 timestamp
    );

    // ============ 查询函数 ============

    function getListing(string calldata _listingId)
        external
        view
        returns (
            address landlord,
            uint256 aiScore,
            bytes32[] memory imageHashes,
            uint256 createdAt,
            bool exists
        )
    {
        ListingRecord storage l = listings[_listingId];
        return (l.landlord, l.aiScore, l.imageHashes, l.createdAt, l.exists);
    }

    function getListingCount() external view returns (uint256) {
        return _allListingIds.length;
    }

    function getContract(string calldata _contractId)
        external
        view
        returns (
            string memory listingId,
            bytes32 contractHash,
            address tenant,
            address landlord,
            uint256 createdAt,
            bool exists
        )
    {
        ContractRecord storage c = contracts[_contractId];
        return (c.listingId, c.contractHash, c.tenant, c.landlord, c.createdAt, c.exists);
    }

    function getDeposit(string calldata _contractId)
        external
        view
        returns (
            uint256 amount,
            DepositStatus status,
            uint256 paidAt,
            uint256 deductionAmount,
            string memory deductionReason
        )
    {
        DepositRecord storage d = deposits[_contractId];
        return (d.amount, d.status, d.paidAt, d.deductionAmount, d.deductionReason);
    }

    // ============ 管理 ============

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), unicode"地址不能为零地址");
        owner = _newOwner;
    }

    receive() external payable {}
}
