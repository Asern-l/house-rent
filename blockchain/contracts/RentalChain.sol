// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RentalChain {
    enum ListingStatus {
        Active,
        Offline,
        Closed
    }

    enum ContractStatus {
        None,
        Created,
        Paid,
        Active,
        Completed,
        Cancelled
    }

    enum GasAuthStatus {
        None,
        Active,
        Revoked,
        Settled
    }

    struct ListingRecord {
        string listingId;
        address landlord;
        bytes32 contentHash;
        uint256 rentAmountWei;
        uint16 minLeaseMonths;
        bytes32 imageRootHash;
        ListingStatus status;
        uint64 version;
        uint64 nonce;
        uint256 createdAt;
        uint256 updatedAt;
        bool exists;
    }

    struct GasAuthorization {
        address tenant;
        address landlord;
        bytes32 contractContentHash;
        uint256 capWei;
        uint256 deadlineMs;
        bytes32 nonce;
        bytes signature;
        uint256 lockedWei;
        GasAuthStatus status;
    }

    struct ContractRecord {
        string contractId;
        string listingId;
        string parentContractId;
        string renewalChildContractId;
        address tenant;
        address landlord;
        bytes32 contentHash;
        uint256 initialAmountWei;
        uint256 startAtMs;
        uint256 endAtMs;
        uint256 createdAt;
        bytes32 tenantMessageHash;
        bytes32 landlordMessageHash;
        uint256 tenantSignedAt;
        uint256 landlordSignedAt;
        ContractStatus status;
        bool exists;
    }

    struct CreateContractParams {
        string contractId;
        string listingId;
        string parentContractId;
        address tenant;
        address landlord;
        bytes32 contentHash;
        bytes32 gasAuthNonce;
        uint256 initialAmountWei;
        uint256 startAtMs;
        uint256 endAtMs;
        bytes32 tenantMessageHash;
        bytes32 landlordMessageHash;
        uint256 tenantSignedAt;
        uint256 landlordSignedAt;
        bytes tenantSignature;
        bytes landlordSignature;
    }

    mapping(string => ListingRecord) private _listings;
    string[] private _allListingIds;
    mapping(string => ContractRecord) private _contracts;
    mapping(string => string) private _activeContractByListing;
    mapping(bytes32 => GasAuthorization) private _gasAuths;

    uint256 public immutable paymentWindowMs;
    uint256 public constant GAS_REIMBURSE_ESTIMATED_UNITS = 350000;
    uint256 public constant GAS_REIMBURSE_MULTIPLIER = 3;

    event ListingCreated(
        string indexed listingId,
        address indexed landlord,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash,
        uint64 version,
        uint64 nonce,
        uint256 blockTime
    );

    event ListingContentUpdated(
        string indexed listingId,
        bytes32 newContentHash,
        uint256 newRentAmountWei,
        uint16 newMinLeaseMonths,
        bytes32 newImageRootHash,
        uint64 version,
        uint64 nonce,
        address indexed operator,
        uint256 blockTime
    );

    event ListingStatusChanged(
        string indexed listingId,
        uint8 oldStatus,
        uint8 newStatus,
        uint64 version,
        uint64 nonce,
        address indexed operator,
        uint256 blockTime
    );

    event GasCompEscrowLocked(bytes32 indexed authId, string indexed contractId, address indexed tenant, address landlord, uint256 capWei, uint256 deadlineMs);
    event GasCompRevoked(bytes32 indexed authId, string indexed contractId, address indexed tenant, uint256 refundedWei);
    event GasCompSettledOnCreate(bytes32 indexed authId, string indexed contractId, address indexed landlord, uint256 compensationWei, uint256 refundWei);
    event RentPaymentRecorded(
        string indexed contractId,
        address indexed payer,
        address indexed landlord,
        uint256 amountWei,
        string orderNo,
        uint256 paidAt
    );
    event ContractCreated(
        string indexed contractId,
        string indexed listingId,
        address indexed landlord,
        address tenant,
        bytes32 contentHash,
        uint256 blockTime
    );
    event ContractStatusChanged(
        string indexed contractId,
        string indexed listingId,
        uint8 oldStatus,
        uint8 newStatus,
        uint256 blockTime
    );
    event ContractSignatureAnchored(
        string indexed contractId,
        address indexed signer,
        bytes32 indexed messageHash,
        uint8 role,
        bytes signature,
        uint256 signedAt
    );
    event RenewalChildLinked(
        string indexed parentContractId,
        string indexed childContractId,
        string indexed listingId,
        uint256 blockTime
    );

    constructor(uint256 paymentWindowMs_) {
        require(paymentWindowMs_ > 0, "payment window required");
        paymentWindowMs = paymentWindowMs_;
    }

    modifier onlyLandlord(string calldata listingId) {
        require(_listings[listingId].exists, "listing not found");
        require(_listings[listingId].landlord == msg.sender, "only landlord");
        _;
    }

    function _gasAuthId(string memory contractId, address tenant, bytes32 nonce) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(contractId, tenant, nonce));
    }

    function _gasAuthDigest(
        string memory contractId,
        bytes32 contractContentHash,
        address tenant,
        address landlord,
        uint256 capWei,
        uint256 deadlineMs,
        bytes32 nonce
    ) private view returns (bytes32) {
        return keccak256(abi.encodePacked(contractId, contractContentHash, tenant, landlord, capWei, deadlineMs, nonce, block.chainid, address(this)));
    }

    function _toEthSignedMessageHash(bytes32 hash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) private pure returns (address) {
        require(signature.length == 65, "invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "invalid signature v");
        return ecrecover(_toEthSignedMessageHash(digest), v, r, s);
    }

    function _isSameString(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _paymentDeadlineMs(ContractRecord storage record) private view returns (uint256) {
        return record.createdAt * 1000 + paymentWindowMs;
    }

    function _isContractPendingPaymentWindow(ContractRecord storage record) private view returns (bool) {
        return record.status == ContractStatus.Created && block.timestamp * 1000 <= _paymentDeadlineMs(record);
    }

    function _isContractPaidReserved(ContractRecord storage record) private view returns (bool) {
        if (record.status != ContractStatus.Paid) return false;
        uint256 nowMs = block.timestamp * 1000;
        return record.startAtMs <= nowMs && nowMs < record.endAtMs;
    }

    function _isContractFutureReserved(ContractRecord storage record) private view returns (bool) {
        if (record.status == ContractStatus.Active || record.status == ContractStatus.Paid) {
            return block.timestamp * 1000 < record.endAtMs;
        }
        return false;
    }

    function _isContractCurrentlyEffective(ContractRecord storage record) private view returns (bool) {
        uint256 nowMs = block.timestamp * 1000;
        if (record.status == ContractStatus.Active || record.status == ContractStatus.Paid) {
            return record.startAtMs <= nowMs && nowMs < record.endAtMs;
        }
        return false;
    }

    function _findCurrentEffectiveContractIdFromHead(string memory headContractId) private view returns (string memory currentContractId) {
        string memory cursor = headContractId;
        while (bytes(cursor).length > 0) {
            ContractRecord storage record = _contracts[cursor];
            if (_isContractCurrentlyEffective(record)) {
                currentContractId = record.contractId;
            }
            cursor = record.renewalChildContractId;
        }
    }

    function _isContractChainBlocking(string memory headContractId) private view returns (bool) {
        string memory cursor = headContractId;
        while (bytes(cursor).length > 0) {
            ContractRecord storage record = _contracts[cursor];
            if (_isContractPendingPaymentWindow(record)) return true;
            if (_isContractFutureReserved(record)) return true;
            cursor = record.renewalChildContractId;
        }
        return false;
    }

    function _isParentCurrentlyEffective(string memory parentContractId) private view returns (bool) {
        if (bytes(parentContractId).length == 0) return false;
        ContractRecord storage parent = _contracts[parentContractId];
        if (!parent.exists) return false;
        return _isContractCurrentlyEffective(parent);
    }

    function _assertGasAuthorizationUsable(
        string calldata contractId,
        address tenant,
        address landlord,
        bytes32 contentHash,
        bytes32 gasAuthNonce
    ) private view returns (bytes32 authId) {
        authId = _gasAuthId(contractId, tenant, gasAuthNonce);
        GasAuthorization storage auth = _gasAuths[authId];
        require(auth.status == GasAuthStatus.Active, "invalid authorization status");
        require(auth.tenant == tenant, "authorization tenant mismatch");
        require(auth.landlord == landlord, "authorization landlord mismatch");
        require(auth.contractContentHash == contentHash, "authorization content hash mismatch");
        require(block.timestamp * 1000 <= auth.deadlineMs, "authorization expired");
    }

    function _assertContractCreateAllowed(CreateContractParams calldata p) private {
        require(p.endAtMs > p.startAtMs, "invalid contract range");
        require(_listings[p.listingId].exists, "listing not found");
        require(_listings[p.listingId].status == ListingStatus.Active, "listing not active");
        require(p.initialAmountWei > 0, "initialAmountWei required");
        require(p.tenantMessageHash != bytes32(0), "tenantMessageHash required");
        require(p.landlordMessageHash != bytes32(0), "landlordMessageHash required");
        require(p.tenantSignedAt > 0, "tenantSignedAt required");
        require(p.landlordSignedAt > 0, "landlordSignedAt required");

        string storage headContractId = _activeContractByListing[p.listingId];
        if (bytes(p.parentContractId).length == 0) {
            require(!_isContractChainBlocking(headContractId), "listing blocked by existing contract chain");
            return;
        }

        require(bytes(headContractId).length > 0, "listing has no contract chain");
        ContractRecord storage parent = _contracts[p.parentContractId];
        require(parent.exists, "parent contract not found");
        require(_isSameString(parent.listingId, p.listingId), "parent listing mismatch");
        require(parent.tenant == p.tenant, "parent tenant mismatch");
        require(parent.landlord == p.landlord, "parent landlord mismatch");
        require(parent.status != ContractStatus.Cancelled && parent.status != ContractStatus.Completed, "parent contract closed");
        require(block.timestamp * 1000 < parent.endAtMs, "parent contract already expired");
        require(bytes(parent.renewalChildContractId).length == 0, "renewal child already exists");
        require(p.startAtMs == parent.endAtMs, "renewal start must equal parent endAtMs");
    }

    function _storeContractRecord(CreateContractParams calldata p) private {
        ContractRecord storage record = _contracts[p.contractId];
        record.contractId = p.contractId;
        record.listingId = p.listingId;
        record.parentContractId = p.parentContractId;
        record.tenant = p.tenant;
        record.landlord = p.landlord;
        record.contentHash = p.contentHash;
        record.initialAmountWei = p.initialAmountWei;
        record.startAtMs = p.startAtMs;
        record.endAtMs = p.endAtMs;
        record.createdAt = block.timestamp;
        record.tenantMessageHash = p.tenantMessageHash;
        record.landlordMessageHash = p.landlordMessageHash;
        record.tenantSignedAt = p.tenantSignedAt;
        record.landlordSignedAt = p.landlordSignedAt;
        record.status = ContractStatus.Created;
        record.exists = true;
    }

    function _settleGasAuthorizationOnCreate(bytes32 authId, string calldata contractId, address landlord) private {
        GasAuthorization storage auth = _gasAuths[authId];
        uint256 reimbursementWei = GAS_REIMBURSE_ESTIMATED_UNITS * tx.gasprice * GAS_REIMBURSE_MULTIPLIER;
        if (reimbursementWei > auth.lockedWei) reimbursementWei = auth.lockedWei;
        uint256 refundWei = auth.lockedWei - reimbursementWei;
        auth.status = GasAuthStatus.Settled;
        auth.lockedWei = 0;

        if (reimbursementWei > 0) {
            (bool okLandlord, ) = landlord.call{value: reimbursementWei}("");
            require(okLandlord, "landlord reimbursement transfer failed");
        }
        if (refundWei > 0) {
            (bool okTenant, ) = auth.tenant.call{value: refundWei}("");
            require(okTenant, "tenant refund transfer failed");
        }

        emit GasCompSettledOnCreate(authId, contractId, landlord, reimbursementWei, refundWei);
    }

    function createListing(
        string calldata listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash
    ) external {
        _createListing(listingId, contentHash, rentAmountWei, minLeaseMonths, imageRootHash);
    }

    function _createListing(
        string memory listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash
    ) internal {
        require(bytes(listingId).length > 0, "listingId required");
        require(!_listings[listingId].exists, "listing already exists");
        require(contentHash != bytes32(0), "contentHash required");
        require(rentAmountWei > 0, "rentAmountWei must > 0");
        require(minLeaseMonths > 0, "minLeaseMonths must > 0");

        ListingRecord storage record = _listings[listingId];
        record.listingId = listingId;
        record.landlord = msg.sender;
        record.contentHash = contentHash;
        record.rentAmountWei = rentAmountWei;
        record.minLeaseMonths = minLeaseMonths;
        record.imageRootHash = imageRootHash;
        record.status = ListingStatus.Active;
        record.version = 1;
        record.nonce = 1;
        record.createdAt = block.timestamp;
        record.updatedAt = block.timestamp;
        record.exists = true;

        _allListingIds.push(listingId);
        emit ListingCreated(listingId, msg.sender, contentHash, rentAmountWei, minLeaseMonths, imageRootHash, record.version, record.nonce, block.timestamp);
    }

    function storeListing(string calldata listingId) external {
        _createListing(listingId, keccak256(abi.encodePacked(listingId, msg.sender)), 1, 1, bytes32(0));
    }

    function createContractRecord(CreateContractParams calldata p) external {
        require(bytes(p.contractId).length > 0, "contractId required");
        require(bytes(p.listingId).length > 0, "listingId required");
        require(p.tenant != address(0), "invalid tenant");
        require(p.landlord != address(0), "invalid landlord");
        require(msg.sender == p.landlord, "only landlord");
        require(p.contentHash != bytes32(0), "contentHash required");
        require(!_contracts[p.contractId].exists, "contract already exists");
        _assertContractCreateAllowed(p);
        bytes32 authId = _assertGasAuthorizationUsable(p.contractId, p.tenant, p.landlord, p.contentHash, p.gasAuthNonce);
        _storeContractRecord(p);
        _settleGasAuthorizationOnCreate(authId, p.contractId, p.landlord);

        if (bytes(p.parentContractId).length == 0) {
            _activeContractByListing[p.listingId] = p.contractId;
        } else {
            _contracts[p.parentContractId].renewalChildContractId = p.contractId;
            emit RenewalChildLinked(p.parentContractId, p.contractId, p.listingId, block.timestamp);
        }

        emit ContractCreated(p.contractId, p.listingId, p.landlord, p.tenant, p.contentHash, block.timestamp);
        emit ContractStatusChanged(p.contractId, p.listingId, uint8(ContractStatus.None), uint8(ContractStatus.Created), block.timestamp);
        emit ContractSignatureAnchored(p.contractId, p.tenant, p.tenantMessageHash, 1, p.tenantSignature, p.tenantSignedAt);
        emit ContractSignatureAnchored(p.contractId, p.landlord, p.landlordMessageHash, 2, p.landlordSignature, p.landlordSignedAt);
    }

    function updateListingTerms(
        string calldata listingId,
        bytes32 newContentHash,
        uint256 newRentAmountWei,
        uint16 newMinLeaseMonths,
        bytes32 newImageRootHash,
        uint64 expectedVersion,
        uint64 expectedNonce
    ) external onlyLandlord(listingId) {
        ListingRecord storage record = _listings[listingId];
        require(record.status != ListingStatus.Closed, "listing already closed");
        require(newContentHash != bytes32(0), "newContentHash required");
        require(newRentAmountWei > 0, "newRentAmountWei must > 0");
        require(newMinLeaseMonths > 0, "newMinLeaseMonths must > 0");
        require(record.version == expectedVersion, "version mismatch");
        require(record.nonce == expectedNonce, "nonce mismatch");

        record.contentHash = newContentHash;
        record.rentAmountWei = newRentAmountWei;
        record.minLeaseMonths = newMinLeaseMonths;
        record.imageRootHash = newImageRootHash;
        record.version += 1;
        record.nonce += 1;
        record.updatedAt = block.timestamp;

        emit ListingContentUpdated(listingId, newContentHash, newRentAmountWei, newMinLeaseMonths, newImageRootHash, record.version, record.nonce, msg.sender, block.timestamp);
    }

    function setListingStatus(
        string calldata listingId,
        ListingStatus newStatus,
        uint64 expectedVersion,
        uint64 expectedNonce
    ) external onlyLandlord(listingId) {
        ListingRecord storage record = _listings[listingId];
        require(record.version == expectedVersion, "version mismatch");
        require(record.nonce == expectedNonce, "nonce mismatch");

        ListingStatus oldStatus = record.status;
        require(oldStatus != ListingStatus.Closed, "listing already closed");
        require(oldStatus != newStatus, "status unchanged");

        record.status = newStatus;
        record.version += 1;
        record.nonce += 1;
        record.updatedAt = block.timestamp;

        emit ListingStatusChanged(listingId, uint8(oldStatus), uint8(newStatus), record.version, record.nonce, msg.sender, block.timestamp);
    }

    function lockGasCompensationEscrow(
        string calldata contractId,
        bytes32 contractContentHash,
        address tenant,
        address landlord,
        uint256 capWei,
        uint256 deadlineMs,
        bytes32 nonce,
        bytes calldata signature
    ) external payable {
        require(msg.sender == tenant, "only tenant can lock escrow");
        require(msg.value == capWei, "escrow value must equal capWei");
        require(capWei > 0, "capWei must > 0");
        require(block.timestamp * 1000 <= deadlineMs, "authorization expired");

        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        require(auth.status == GasAuthStatus.None, "authorization already exists");

        bytes32 digest = _gasAuthDigest(contractId, contractContentHash, tenant, landlord, capWei, deadlineMs, nonce);
        address recovered = _recoverSigner(digest, signature);
        require(recovered == tenant, "invalid authorization signature");

        auth.tenant = tenant;
        auth.landlord = landlord;
        auth.contractContentHash = contractContentHash;
        auth.capWei = capWei;
        auth.deadlineMs = deadlineMs;
        auth.nonce = nonce;
        auth.signature = signature;
        auth.lockedWei = msg.value;
        auth.status = GasAuthStatus.Active;

        emit GasCompEscrowLocked(authId, contractId, tenant, landlord, capWei, deadlineMs);
    }

    function revokeGasCompensationAuthorization(string calldata contractId, address tenant, bytes32 nonce) external {
        require(msg.sender == tenant, "only tenant can revoke");
        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        require(auth.status == GasAuthStatus.Active, "only active authorization can revoke");

        auth.status = GasAuthStatus.Revoked;
        uint256 refundWei = auth.lockedWei;
        auth.lockedWei = 0;

        (bool ok, ) = tenant.call{value: refundWei}("");
        require(ok, "refund failed");
        emit GasCompRevoked(authId, contractId, tenant, refundWei);
    }

    function cancelPendingGasAuthorization(string calldata contractId, address tenant, bytes32 nonce) external {
        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        require(auth.tenant != address(0), "authorization not found");
        require(msg.sender == auth.tenant || msg.sender == auth.landlord, "only contract parties");
        if (auth.status != GasAuthStatus.Active) {
            return;
        }

        auth.status = GasAuthStatus.Revoked;
        uint256 refundWei = auth.lockedWei;
        auth.lockedWei = 0;

        (bool ok, ) = auth.tenant.call{value: refundWei}("");
        require(ok, "refund failed");
        emit GasCompRevoked(authId, contractId, auth.tenant, refundWei);
    }

    function recordInitialRentPayment(
        string calldata contractId,
        address landlord,
        string calldata orderNo
    ) external payable {
        require(bytes(contractId).length > 0, "contractId required");
        require(landlord != address(0), "invalid landlord");
        ContractRecord storage record = _contracts[contractId];
        require(record.exists, "contract not found");
        require(record.landlord == landlord, "landlord mismatch");
        require(record.status == ContractStatus.Created, "contract not payable");
        require(msg.value == record.initialAmountWei, "invalid payment amount");
        require(block.timestamp * 1000 <= _paymentDeadlineMs(record), "payment deadline expired");

        if (bytes(record.parentContractId).length > 0) {
            ContractRecord storage parent = _contracts[record.parentContractId];
            require(parent.exists, "parent contract not found");
            require(parent.status != ContractStatus.Cancelled && parent.status != ContractStatus.Completed, "parent contract unavailable");
        }

        (bool ok, ) = landlord.call{value: msg.value}("");
        require(ok, "transfer to landlord failed");
        ContractStatus nextStatus = _isParentCurrentlyEffective(record.parentContractId)
            ? ContractStatus.Paid
            : ContractStatus.Active;
        record.status = nextStatus;
        emit RentPaymentRecorded(contractId, msg.sender, landlord, msg.value, orderNo, block.timestamp);
        emit ContractStatusChanged(contractId, record.listingId, uint8(ContractStatus.Created), uint8(nextStatus), block.timestamp);
    }

    function completeExpiredContract(string calldata contractId) external {
        ContractRecord storage record = _contracts[contractId];
        require(record.exists, "contract not found");
        require(record.status == ContractStatus.Active, "contract not active");
        require(record.endAtMs > 0 && block.timestamp * 1000 >= record.endAtMs, "contract not expired");

        record.status = ContractStatus.Completed;
        emit ContractStatusChanged(contractId, record.listingId, uint8(ContractStatus.Active), uint8(ContractStatus.Completed), block.timestamp);
    }

    function getGasAuthorization(string calldata contractId, address tenant, bytes32 nonce)
        external
        view
        returns (address outTenant, address outLandlord, bytes32 outContractContentHash, uint256 capWei, uint256 deadlineMs, uint256 lockedWei, uint8 status)
    {
        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        return (auth.tenant, auth.landlord, auth.contractContentHash, auth.capWei, auth.deadlineMs, auth.lockedWei, uint8(auth.status));
    }

    function getContractRecord(string calldata contractId)
        external
        view
        returns (ContractRecord memory record)
    {
        record = _contracts[contractId];
    }

    function getActiveContractByListing(string calldata listingId) external view returns (string memory headContractId) {
        return _activeContractByListing[listingId];
    }

    function getCurrentEffectiveContractByListing(string calldata listingId) external view returns (string memory currentContractId) {
        string memory headContractId = _activeContractByListing[listingId];
        return _findCurrentEffectiveContractIdFromHead(headContractId);
    }

    function getListing(string calldata listingId)
        external
        view
        returns (ListingRecord memory record)
    {
        record = _listings[listingId];
    }

    function getListingCount() external view returns (uint256) {
        return _allListingIds.length;
    }
}
