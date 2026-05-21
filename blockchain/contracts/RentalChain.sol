/**
 * 文件说明：RentalChain.sol
 * - 租房场景智能合约，提供房源存证、合同存证、押金托管与租金存证能力。
 * - 当前原型阶段：房源仅做最小字段存证（listingId + landlord + createdAt）。
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RentalChain
 * @notice 区块链租房合约（原型版）
 */
contract RentalChain {
    // ============ 枚举 ============

    /** 押金状态枚举 */
    enum DepositStatus { None, Paid, Refunding, Refunded, PartiallyRefunded, Disputed }

    /** 合同支付状态枚举 */
    enum ContractPayStatus { None, PaymentPending, Active, Cancelled }

    // ============ 结构体 ============

    /** 房源存证记录（最小字段） */
    struct ListingRecord {
        string listingId;
        address landlord;
        uint256 createdAt;
        bool exists;
    }

    /** 合同存证记录 */
    struct ContractRecord {
        string contractId;
        string listingId;
        bytes32 contractHash;
        address tenant;
        address landlord;
        uint256 createdAt;
        uint256 paymentDeadline;
        uint256 initialAmount;
        ContractPayStatus payStatus;
        bool exists;
    }

    /** 押金托管记录 */
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
    address public paymentAuthorizer;

    // listingId => ListingRecord
    mapping(string => ListingRecord) public listings;
    string[] private _allListingIds;

    // contractId => ContractRecord
    mapping(string => ContractRecord) public contracts;
    string[] private _allContractIds;

    // contractId => DepositRecord
    mapping(string => DepositRecord) public deposits;

    // nonce => used
    mapping(bytes32 => bool) public usedPaymentNonces;

    // ============ 事件 ============

    event ListingStored(
        string indexed listingId,
        address indexed landlord,
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

    event RentReceipt(
        string indexed contractId,
        address indexed tenant,
        address indexed landlord,
        uint256 amount,
        string alipayOrderNo,
        uint256 timestamp
    );

    event PaymentAuthorizerChanged(address indexed oldAuthorizer, address indexed newAuthorizer);

    // ============ 修饰符 ============

    /** 仅合约拥有者可调用 */
    modifier onlyOwner() {
        require(msg.sender == owner, unicode"只有合约拥有者可以调用");
        _;
    }

    // ============ 构造函数 ============

    constructor() {
        owner = msg.sender;
        paymentAuthorizer = msg.sender;
    }

    // ============ 房源存证 ============

    /**
     * 函数 1：存证房源最小信息。
     * @param _listingId 房源ID
     */
    function storeListing(string calldata _listingId) external {
        require(!listings[_listingId].exists, unicode"房源ID已存在");

        ListingRecord storage record = listings[_listingId];
        record.listingId = _listingId;
        record.landlord = msg.sender;
        record.createdAt = block.timestamp;
        record.exists = true;

        _allListingIds.push(_listingId);

        emit ListingStored(_listingId, msg.sender, block.timestamp);
    }

    // ============ 合同存证 ============

    /**
     * 函数 2：存证合同哈希。
     */
    function storeContract(
        string calldata _contractId,
        string calldata _listingId,
        bytes32 _contractHash,
        address _tenant,
        address _landlord
    ) external {
        _storeContract(_contractId, _listingId, _contractHash, _tenant, _landlord, block.timestamp + 2 hours, 0);
    }

    /**
     * 函数 2-1：存证合同哈希并固化首笔支付准入条件。
     */
    function storeContractWithPaymentTerms(
        string calldata _contractId,
        string calldata _listingId,
        bytes32 _contractHash,
        address _tenant,
        address _landlord,
        uint256 _paymentDeadline,
        uint256 _initialAmount
    ) external {
        require(_paymentDeadline > block.timestamp, unicode"支付截止时间必须晚于当前时间");
        require(_initialAmount > 0, unicode"首笔支付金额必须大于0");
        _storeContract(_contractId, _listingId, _contractHash, _tenant, _landlord, _paymentDeadline, _initialAmount);
    }

    function _storeContract(
        string calldata _contractId,
        string calldata _listingId,
        bytes32 _contractHash,
        address _tenant,
        address _landlord,
        uint256 _paymentDeadline,
        uint256 _initialAmount
    ) internal {
        require(!contracts[_contractId].exists, unicode"合同ID已存在");
        require(_tenant != address(0) && _landlord != address(0), unicode"签约地址不能为空");

        ContractRecord storage record = contracts[_contractId];
        record.contractId = _contractId;
        record.listingId = _listingId;
        record.contractHash = _contractHash;
        record.tenant = _tenant;
        record.landlord = _landlord;
        record.createdAt = block.timestamp;
        record.paymentDeadline = _paymentDeadline;
        record.initialAmount = _initialAmount;
        record.payStatus = ContractPayStatus.PaymentPending;
        record.exists = true;

        _allContractIds.push(_contractId);

        emit ContractStored(_contractId, _listingId, _contractHash, _tenant, _landlord, block.timestamp);
    }

    // ============ 押金管理 ============

    /**
     * 函数 3：租客支付押金到合约托管。
     */
    function payDeposit(string calldata _contractId) external payable {
        require(contracts[_contractId].exists, unicode"合同不存在");
        require(msg.sender == contracts[_contractId].tenant, unicode"仅租客可支付押金");
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

    /**
     * 函数 4：租客发起退押申请。
     */
    function requestRefund(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金记录不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.tenant, unicode"仅租客可发起退押");
        require(dep.status == DepositStatus.Paid, unicode"押金状态不允许发起退押");

        dep.status = DepositStatus.Refunding;
        emit RefundRequested(_contractId, msg.sender, block.timestamp);
    }

    /**
     * 函数 5：房东确认全额退押。
     */
    function confirmRefund(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金记录不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.landlord, unicode"仅房东可确认退押");
        require(dep.status == DepositStatus.Refunding, unicode"押金不在退押流程中");

        dep.status = DepositStatus.Refunded;
        uint256 amount = dep.amount;

        payable(dep.tenant).transfer(amount);

        emit RefundConfirmed(_contractId, amount, block.timestamp);
    }

    /**
     * 函数 6：房东提出扣款方案。
     */
    function proposeDeduction(
        string calldata _contractId,
        uint256 _amount,
        string calldata _reason
    ) external {
        require(deposits[_contractId].exists, unicode"押金记录不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.landlord, unicode"仅房东可提出扣款");
        require(dep.status == DepositStatus.Refunding, unicode"押金不在退押流程中");
        require(_amount > 0 && _amount <= dep.amount, unicode"扣款金额不合法");

        dep.deductionAmount = _amount;
        dep.deductionReason = _reason;

        emit DeductionProposed(_contractId, _amount, _reason, block.timestamp);
    }

    /**
     * 函数 7：租客接受扣款并分账。
     */
    function acceptDeduction(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金记录不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.tenant, unicode"仅租客可接受扣款");
        require(dep.deductionAmount > 0, unicode"尚未提出扣款方案");
        require(dep.status == DepositStatus.Refunding, unicode"押金状态不允许接受扣款");

        dep.status = DepositStatus.PartiallyRefunded;

        uint256 toTenant = dep.amount - dep.deductionAmount;
        uint256 toLandlord = dep.deductionAmount;

        if (toTenant > 0) {
            payable(dep.tenant).transfer(toTenant);
        }
        payable(dep.landlord).transfer(toLandlord);

        emit DeductionAccepted(_contractId, toTenant, toLandlord, block.timestamp);
    }

    /**
     * 函数 8：租客或房东发起押金纠纷。
     */
    function disputeDeposit(string calldata _contractId) external {
        require(deposits[_contractId].exists, unicode"押金记录不存在");
        DepositRecord storage dep = deposits[_contractId];
        require(msg.sender == dep.tenant || msg.sender == dep.landlord, unicode"仅租客或房东可发起纠纷");
        require(dep.status == DepositStatus.Refunding, unicode"押金不在退押流程中");

        dep.status = DepositStatus.Disputed;

        emit DepositDisputed(_contractId, msg.sender, block.timestamp);
    }

    /**
     * 函数 9：平台仲裁押金归属。
     */
    function resolveDeposit(string calldata _contractId, bool _toTenant) external onlyOwner {
        require(deposits[_contractId].exists, unicode"押金记录不存在");
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

    // ============ 租金支付存证 ============

    /**
     * 函数 10：记录租金支付事实（仅事件存证）。
     */
    function recordRentPayment(
        string calldata _contractId,
        address _tenant,
        address _landlord,
        uint256 _amount,
        string calldata _alipayOrderNo
    ) external payable {
        revert(unicode"请使用后端授权签名支付函数");
    }

    /**
     * 函数 10-1：基于后端一次性授权签名记录首笔租金支付。
     */
    function recordRentPaymentAuthorized(
        string calldata _contractId,
        address _tenant,
        address _landlord,
        uint256 _amount,
        string calldata _alipayOrderNo,
        uint256 _deadline,
        bytes32 _nonce,
        bytes calldata _signature
    ) external payable {
        require(contracts[_contractId].exists, unicode"合同不存在");
        require(msg.sender == _tenant, unicode"仅租客可发起支付");
        require(_tenant == contracts[_contractId].tenant, unicode"租客地址不匹配");
        require(_landlord == contracts[_contractId].landlord, unicode"房东地址不匹配");
        require(_amount > 0, unicode"支付金额必须大于0");
        require(msg.value == _amount, unicode"转入金额与参数金额不一致");
        require(contracts[_contractId].payStatus == ContractPayStatus.PaymentPending, unicode"合同当前状态不可支付");
        require(block.timestamp <= contracts[_contractId].paymentDeadline, unicode"合同支付窗口已关闭");
        require(_deadline >= block.timestamp, unicode"支付授权已过期");
        require(!usedPaymentNonces[_nonce], unicode"支付授权已使用");

        uint256 expectedAmount = contracts[_contractId].initialAmount;
        require(expectedAmount == 0 || expectedAmount == _amount, unicode"支付金额与合同不一致");

        bytes32 rawHash = keccak256(abi.encodePacked(
            _contractId,
            _tenant,
            _amount,
            _deadline,
            _nonce,
            block.chainid,
            address(this)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", rawHash));
        require(_recoverSigner(ethHash, _signature) == paymentAuthorizer, unicode"支付授权签名无效");

        usedPaymentNonces[_nonce] = true;
        contracts[_contractId].payStatus = ContractPayStatus.Active;

        payable(_landlord).transfer(msg.value);
        emit RentReceipt(_contractId, _tenant, _landlord, _amount, _alipayOrderNo, block.timestamp);
    }

    // ============ 查询函数 ============

    /** 函数 11：查询房源存证记录。 */
    function getListing(string calldata _listingId)
        external
        view
        returns (
            address landlord,
            uint256 createdAt,
            bool exists
        )
    {
        ListingRecord storage l = listings[_listingId];
        return (l.landlord, l.createdAt, l.exists);
    }

    /** 函数 12：查询房源数量。 */
    function getListingCount() external view returns (uint256) {
        return _allListingIds.length;
    }

    /** 函数 13：查询合同存证记录。 */
    function getContract(string calldata _contractId)
        external
        view
        returns (
            string memory listingId,
            bytes32 contractHash,
            address tenant,
            address landlord,
            uint256 createdAt,
            uint256 paymentDeadline,
            uint256 initialAmount,
            ContractPayStatus payStatus,
            bool exists
        )
    {
        ContractRecord storage c = contracts[_contractId];
        return (c.listingId, c.contractHash, c.tenant, c.landlord, c.createdAt, c.paymentDeadline, c.initialAmount, c.payStatus, c.exists);
    }

    /** 函数 14：查询押金记录。 */
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

    // ============ 管理函数 ============

    /** 函数 15：转移合约拥有者。 */
    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), unicode"新拥有者地址不能为空");
        owner = _newOwner;
    }

    /** 函数 16：设置后端支付授权签名地址。 */
    function setPaymentAuthorizer(address _newAuthorizer) external onlyOwner {
        require(_newAuthorizer != address(0), unicode"授权地址不能为空");
        emit PaymentAuthorizerChanged(paymentAuthorizer, _newAuthorizer);
        paymentAuthorizer = _newAuthorizer;
    }

    function _recoverSigner(bytes32 _hash, bytes memory _signature) internal pure returns (address) {
        require(_signature.length == 65, unicode"签名长度不正确");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(_signature, 32))
            s := mload(add(_signature, 64))
            v := byte(0, mload(add(_signature, 96)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, unicode"签名v值不正确");
        return ecrecover(_hash, v, r, s);
    }

    receive() external payable {}
}
