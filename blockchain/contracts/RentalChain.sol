// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract RentalChain is ReentrancyGuard {
    bytes32 private constant ACTION_CREATE_LISTING = keccak256("createListing");
    bytes32 private constant ACTION_UPDATE_LISTING_TERMS = keccak256("updateListingTerms");
    bytes32 private constant ACTION_SET_LISTING_STATUS = keccak256("setListingStatus");
    bytes32 private constant ACTION_CREATE_CONTRACT = keccak256("createContractRecord");
    bytes32 private constant ACTION_RECORD_INITIAL_PAYMENT = keccak256("recordInitialRentPayment");
    bytes32 private constant ACTION_SUBMIT_RENTAL_REVIEW = keccak256("submitRentalReview");
    bytes32 private constant ACTION_SUBMIT_LISTING_FEEDBACK = keccak256("submitListingFeedback");

    error PaymentWindowRequired();
    error TrustedSignerRequired();
    error PlatformFeeRecipientRequired();
    error ListingNotFound();
    error OnlyLandlord();
    error PermitExpired();
    error PermitSignatureRequired();
    error PermitAlreadyUsed();
    error InvalidPermitSigner();
    error InvalidAuthorizationStatus();
    error AuthorizationTenantMismatch();
    error AuthorizationLandlordMismatch();
    error AuthorizationContentHashMismatch();
    error AuthorizationExpired();
    error InvalidContractRange();
    error ListingNotActive();
    error InitialAmountWeiRequired();
    error LeaseMonthsRequired();
    error TenantMessageHashRequired();
    error LandlordMessageHashRequired();
    error TenantSignedAtRequired();
    error LandlordSignedAtRequired();
    error ListingBlockedByExistingContractChain();
    error ListingHasNoContractChain();
    error ParentContractNotFound();
    error ParentListingMismatch();
    error ParentTenantMismatch();
    error ParentLandlordMismatch();
    error ParentContractClosed();
    error ParentContractAlreadyExpired();
    error RenewalChildAlreadyExists();
    error RenewalStartMustEqualParentEndAtMs();
    error LandlordReimbursementTransferFailed();
    error TenantRefundTransferFailed();
    error ListingIdRequired();
    error ListingAlreadyExists();
    error ContentHashRequired();
    error RentAmountWeiMustBePositive();
    error MinLeaseMonthsMustBePositive();
    error SnapshotHashRequired();
    error SnapshotCidRequired();
    error ContractIdRequired();
    error InvalidTenant();
    error InvalidLandlord();
    error ContractAlreadyExists();
    error ListingAlreadyClosed();
    error NewContentHashRequired();
    error NewRentAmountWeiMustBePositive();
    error NewMinLeaseMonthsMustBePositive();
    error NewSnapshotHashRequired();
    error NewSnapshotCidRequired();
    error VersionMismatch();
    error NonceMismatch();
    error StatusUnchanged();
    error OnlyTenantCanLockEscrow();
    error EscrowValueMustEqualCapWei();
    error CapWeiMustBePositive();
    error AuthorizationAlreadyExists();
    error InvalidAuthorizationSignature();
    error OnlyTenantCanRevoke();
    error OnlyActiveAuthorizationCanRevoke();
    error RefundFailed();
    error AuthorizationNotFound();
    error OnlyContractParties();
    error ContractNotFound();
    error OnlyTenantCanPay();
    error LandlordMismatch();
    error ContractNotPayable();
    error InvalidPaymentAmount();
    error PaymentDeadlineExpired();
    error ParentContractUnavailable();
    error TransferFeeFailed();
    error TransferGuaranteeFailed();
    error OnlyReleaseManager();
    error ContractNotReleasable();
    error EscrowAlreadyReleased();
    error NoReleasableRent();
    error ReleaseAmountZero();
    error ReleaseTransferFailed();
    error OnlyTenantCanTerminate();
    error ContractNotTerminable();
    error CommentHashRequired();
    error RatingOutOfRange();
    error CommentCidRequired();
    error OnlyTenantCanReview();
    error ContractNotReviewable();
    error ReviewNotOpen();
    error ReviewWindowClosed();
    error ReviewAlreadySubmitted();
    error FeedbackTypeOutOfRange();
    error ContractNotActive();
    error ContractNotExpired();


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
        uint16 leaseMonths;
        uint256 escrowTotalWei;
        uint256 performanceGuaranteeWei;
        uint256 monthlyReleaseWei;
        uint256 releasedWei;
        uint256 refundedWei;
        uint16 releasedPeriods;
        uint256 terminatedAtMs;
        ContractStatus status;
        bool exists;
    }

    struct RentalReview {
        bool exists;
        uint8 rating;
        bytes32 commentHash;
        uint64 ratedAt;
        address tenant;
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
        uint16 leaseMonths;
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
    mapping(string => RentalReview) private _rentalReviews;
    mapping(bytes32 => bool) private _usedPermitDigests;

    address public immutable trustedSigner;
    address public immutable platformFeeRecipient;
    uint256 public immutable paymentWindowMs;
    uint256 public constant REVIEW_WINDOW_MS = 30 days;
    uint256 public constant GAS_REIMBURSE_ESTIMATED_UNITS = 350000;
    uint256 public constant GAS_REIMBURSE_MULTIPLIER = 3;
    uint256 public constant PLATFORM_FEE_BPS = 10;
    uint256 public constant PERFORMANCE_GUARANTEE_BPS = 1000;
    uint256 public constant BPS_DENOMINATOR = 10000;

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

    event ListingSnapshotAnchored(
        string indexed listingId,
        uint64 indexed version,
        bytes32 indexed contentHash,
        bytes32 snapshotHash,
        string snapshotCid,
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
        uint256 platformFeeWei,
        uint256 performanceGuaranteeWei,
        uint256 escrowWei,
        address platformFeeRecipient,
        string orderNo,
        uint256 paidAt
    );
    event RentReleased(
        string indexed contractId,
        string indexed listingId,
        address indexed landlord,
        uint16 releasedPeriods,
        uint256 amountWei,
        uint256 releasedWei,
        uint256 releasedAt
    );
    event ContractEarlyTerminated(
        string indexed contractId,
        string indexed listingId,
        address indexed tenant,
        uint256 landlordSettledWei,
        uint256 refundedWei,
        uint256 terminatedAtMs
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
    event RentalReviewSubmitted(
        string indexed contractId,
        string indexed listingId,
        address indexed tenant,
        uint8 rating,
        bytes32 commentHash,
        string commentCid,
        uint256 ratedAt
    );
    event ListingFeedbackSubmitted(
        string indexed listingId,
        address indexed sender,
        uint8 feedbackType,
        bytes32 commentHash,
        string commentCid,
        uint256 createdAt
    );

    constructor(uint256 paymentWindowMs_, address trustedSigner_, address platformFeeRecipient_) {
        if (paymentWindowMs_ == 0) revert PaymentWindowRequired();
        if (trustedSigner_ == address(0)) revert TrustedSignerRequired();
        if (platformFeeRecipient_ == address(0)) revert PlatformFeeRecipientRequired();
        paymentWindowMs = paymentWindowMs_;
        trustedSigner = trustedSigner_;
        platformFeeRecipient = platformFeeRecipient_;
    }

    modifier onlyLandlord(string calldata listingId) {
        if (!_listings[listingId].exists) revert ListingNotFound();
        if (_listings[listingId].landlord != msg.sender) revert OnlyLandlord();
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

    function _recoverSigner(bytes32 digest, bytes memory signature) private pure returns (address) {
        return ECDSA.recover(ECDSA.toEthSignedMessageHash(digest), signature);
    }

    function _isSameString(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _stringHash(string memory value) private pure returns (bytes32) {
        return keccak256(bytes(value));
    }

    function _permitDigest(
        bytes32 actionHash,
        address caller,
        bytes32 subjectHash,
        bytes32 paramsHash,
        bytes32 nonce,
        uint256 deadlineMs
    ) private view returns (bytes32) {
        return keccak256(abi.encode(actionHash, caller, subjectHash, paramsHash, nonce, deadlineMs, block.chainid, address(this)));
    }

    function _consumePermit(
        bytes32 actionHash,
        address caller,
        bytes32 subjectHash,
        bytes32 paramsHash,
        bytes32 nonce,
        uint256 deadlineMs,
        bytes calldata signature
    ) private {
        if (block.timestamp * 1000 > deadlineMs) revert PermitExpired();
        if (signature.length == 0) revert PermitSignatureRequired();
        bytes32 digest = _permitDigest(actionHash, caller, subjectHash, paramsHash, nonce, deadlineMs);
        if (_usedPermitDigests[digest]) revert PermitAlreadyUsed();
        address recovered = _recoverSigner(digest, signature);
        if (recovered != trustedSigner) revert InvalidPermitSigner();
        _usedPermitDigests[digest] = true;
    }

    function _hashCreateListingParams(
        string calldata listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash,
        bytes32 snapshotHash,
        string calldata snapshotCid
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(listingId, contentHash, rentAmountWei, minLeaseMonths, imageRootHash, snapshotHash, snapshotCid));
    }

    function _hashCreateContractParams(CreateContractParams calldata p) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                p.contractId,
                p.listingId,
                p.parentContractId,
                p.tenant,
                p.landlord,
                p.contentHash,
                p.gasAuthNonce,
                p.initialAmountWei,
                p.startAtMs,
                p.endAtMs,
                p.leaseMonths,
                p.tenantMessageHash,
                p.landlordMessageHash,
                p.tenantSignedAt,
                p.landlordSignedAt,
                keccak256(p.tenantSignature),
                keccak256(p.landlordSignature)
            )
        );
    }

    function _hashUpdateListingTermsParams(
        string calldata listingId,
        bytes32 newContentHash,
        uint256 newRentAmountWei,
        uint16 newMinLeaseMonths,
        bytes32 newImageRootHash,
        bytes32 newSnapshotHash,
        string calldata newSnapshotCid,
        uint64 expectedVersion,
        uint64 expectedNonce
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                listingId,
                newContentHash,
                newRentAmountWei,
                newMinLeaseMonths,
                newImageRootHash,
                newSnapshotHash,
                newSnapshotCid,
                expectedVersion,
                expectedNonce
            )
        );
    }

    function _hashSetListingStatusParams(
        string calldata listingId,
        ListingStatus newStatus,
        uint64 expectedVersion,
        uint64 expectedNonce
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(listingId, uint8(newStatus), expectedVersion, expectedNonce));
    }

    function _hashInitialPaymentParams(
        string calldata contractId,
        address landlord,
        string calldata orderNo,
        uint256 amountWei
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(contractId, landlord, orderNo, amountWei));
    }

    function _hashRentalReviewParams(
        string calldata contractId,
        bytes32 commentHash,
        uint8 rating,
        string calldata commentCid
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(contractId, commentHash, rating, commentCid));
    }

    function _hashListingFeedbackParams(
        string calldata listingId,
        uint8 feedbackType,
        bytes32 commentHash,
        string calldata commentCid
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(listingId, feedbackType, commentHash, commentCid));
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

    function _earnedReleasePeriods(ContractRecord storage record) private view returns (uint16) {
        if (record.leaseMonths == 0) return 0;
        uint256 nowMs = block.timestamp * 1000;
        if (nowMs <= record.startAtMs) return 0;
        if (nowMs >= record.endAtMs) return record.leaseMonths;
        uint256 totalRange = record.endAtMs - record.startAtMs;
        if (totalRange == 0) return record.leaseMonths;
        uint256 elapsed = nowMs - record.startAtMs;
        uint256 earned = (elapsed * record.leaseMonths) / totalRange;
        if (earned > record.leaseMonths) earned = record.leaseMonths;
        return uint16(earned);
    }

    function _earnedEscrowWeiAt(ContractRecord storage record, uint256 atMs) private view returns (uint256) {
        if (record.escrowTotalWei == 0) return 0;
        if (record.endAtMs <= record.startAtMs) return 0;
        if (atMs <= record.startAtMs) return 0;
        if (atMs >= record.endAtMs) return record.escrowTotalWei;
        uint256 elapsed = atMs - record.startAtMs;
        uint256 totalRange = record.endAtMs - record.startAtMs;
        return (record.escrowTotalWei * elapsed) / totalRange;
    }

    function _cancelFutureRenewalChildOnParentTermination(ContractRecord storage parent, uint256 terminatedAtMs) private {
        string storage childContractId = parent.renewalChildContractId;
        if (bytes(childContractId).length == 0) return;

        ContractRecord storage child = _contracts[childContractId];
        if (!child.exists) return;
        if (child.startAtMs <= terminatedAtMs) return;
        if (child.status != ContractStatus.Created && child.status != ContractStatus.Paid) return;

        ContractStatus oldStatus = child.status;
        uint256 refundWei = 0;
        if (oldStatus == ContractStatus.Paid) {
            refundWei = child.escrowTotalWei - child.releasedWei;
            child.refundedWei += refundWei;
        }
        child.status = ContractStatus.Cancelled;

        if (refundWei > 0) {
            (bool okRefund, ) = child.tenant.call{value: refundWei}("");
            if (!okRefund) revert TenantRefundTransferFailed();
        }

        emit ContractStatusChanged(child.contractId, child.listingId, uint8(oldStatus), uint8(ContractStatus.Cancelled), block.timestamp);
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
        if (auth.status != GasAuthStatus.Active) revert InvalidAuthorizationStatus();
        if (auth.tenant != tenant) revert AuthorizationTenantMismatch();
        if (auth.landlord != landlord) revert AuthorizationLandlordMismatch();
        if (auth.contractContentHash != contentHash) revert AuthorizationContentHashMismatch();
        if (block.timestamp * 1000 > auth.deadlineMs) revert AuthorizationExpired();
    }

    function _assertContractCreateAllowed(CreateContractParams calldata p) private view {
        if (p.endAtMs <= p.startAtMs) revert InvalidContractRange();
        if (!_listings[p.listingId].exists) revert ListingNotFound();
        if (_listings[p.listingId].status != ListingStatus.Active) revert ListingNotActive();
        if (p.initialAmountWei == 0) revert InitialAmountWeiRequired();
        if (p.leaseMonths == 0) revert LeaseMonthsRequired();
        if (p.tenantMessageHash == bytes32(0)) revert TenantMessageHashRequired();
        if (p.landlordMessageHash == bytes32(0)) revert LandlordMessageHashRequired();
        if (p.tenantSignedAt == 0) revert TenantSignedAtRequired();
        if (p.landlordSignedAt == 0) revert LandlordSignedAtRequired();

        string storage headContractId = _activeContractByListing[p.listingId];
        if (bytes(p.parentContractId).length == 0) {
            if (_isContractChainBlocking(headContractId)) revert ListingBlockedByExistingContractChain();
            return;
        }

        if (bytes(headContractId).length == 0) revert ListingHasNoContractChain();
        ContractRecord storage parent = _contracts[p.parentContractId];
        if (!parent.exists) revert ParentContractNotFound();
        if (!_isSameString(parent.listingId, p.listingId)) revert ParentListingMismatch();
        if (parent.tenant != p.tenant) revert ParentTenantMismatch();
        if (parent.landlord != p.landlord) revert ParentLandlordMismatch();
        if (parent.status == ContractStatus.Cancelled || parent.status == ContractStatus.Completed) revert ParentContractClosed();
        if (block.timestamp * 1000 >= parent.endAtMs) revert ParentContractAlreadyExpired();
        if (bytes(parent.renewalChildContractId).length != 0) revert RenewalChildAlreadyExists();
        if (p.startAtMs != parent.endAtMs) revert RenewalStartMustEqualParentEndAtMs();
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
        record.leaseMonths = p.leaseMonths;
        record.createdAt = block.timestamp;
        record.tenantMessageHash = p.tenantMessageHash;
        record.landlordMessageHash = p.landlordMessageHash;
        record.tenantSignedAt = p.tenantSignedAt;
        record.landlordSignedAt = p.landlordSignedAt;
        record.escrowTotalWei = 0;
        record.performanceGuaranteeWei = 0;
        record.monthlyReleaseWei = 0;
        record.releasedWei = 0;
        record.refundedWei = 0;
        record.releasedPeriods = 0;
        record.terminatedAtMs = 0;
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
            if (!okLandlord) revert LandlordReimbursementTransferFailed();
        }
        if (refundWei > 0) {
            (bool okTenant, ) = auth.tenant.call{value: refundWei}("");
            if (!okTenant) revert TenantRefundTransferFailed();
        }

        emit GasCompSettledOnCreate(authId, contractId, landlord, reimbursementWei, refundWei);
    }

    function createListing(
        string calldata listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash,
        bytes32 snapshotHash,
        string calldata snapshotCid,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external {
        _consumePermit(
            ACTION_CREATE_LISTING,
            msg.sender,
            _stringHash(listingId),
            _hashCreateListingParams(listingId, contentHash, rentAmountWei, minLeaseMonths, imageRootHash, snapshotHash, snapshotCid),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );
        _createListing(listingId, contentHash, rentAmountWei, minLeaseMonths, imageRootHash, snapshotHash, snapshotCid);
    }

    function _createListing(
        string memory listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash,
        bytes32 snapshotHash,
        string memory snapshotCid
    ) internal {
        if (bytes(listingId).length == 0) revert ListingIdRequired();
        if (_listings[listingId].exists) revert ListingAlreadyExists();
        if (contentHash == bytes32(0)) revert ContentHashRequired();
        if (rentAmountWei == 0) revert RentAmountWeiMustBePositive();
        if (minLeaseMonths == 0) revert MinLeaseMonthsMustBePositive();
        if (snapshotHash == bytes32(0)) revert SnapshotHashRequired();
        if (bytes(snapshotCid).length == 0) revert SnapshotCidRequired();

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
        emit ListingSnapshotAnchored(listingId, record.version, contentHash, snapshotHash, snapshotCid, block.timestamp);
    }

    function createContractRecord(
        CreateContractParams calldata p,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external nonReentrant {
        if (bytes(p.contractId).length == 0) revert ContractIdRequired();
        if (bytes(p.listingId).length == 0) revert ListingIdRequired();
        if (p.tenant == address(0)) revert InvalidTenant();
        if (p.landlord == address(0)) revert InvalidLandlord();
        if (msg.sender != p.landlord) revert OnlyLandlord();
        _consumePermit(
            ACTION_CREATE_CONTRACT,
            msg.sender,
            _stringHash(p.contractId),
            _hashCreateContractParams(p),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );
        if (p.contentHash == bytes32(0)) revert ContentHashRequired();
        if (_contracts[p.contractId].exists) revert ContractAlreadyExists();
        _assertContractCreateAllowed(p);
        bytes32 authId = _assertGasAuthorizationUsable(p.contractId, p.tenant, p.landlord, p.contentHash, p.gasAuthNonce);
        _storeContractRecord(p);

        if (bytes(p.parentContractId).length == 0) {
            _activeContractByListing[p.listingId] = p.contractId;
        } else {
            _contracts[p.parentContractId].renewalChildContractId = p.contractId;
            emit RenewalChildLinked(p.parentContractId, p.contractId, p.listingId, block.timestamp);
        }

        _settleGasAuthorizationOnCreate(authId, p.contractId, p.landlord);

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
        bytes32 newSnapshotHash,
        string calldata newSnapshotCid,
        uint64 expectedVersion,
        uint64 expectedNonce,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external nonReentrant onlyLandlord(listingId) {
        ListingRecord storage record = _listings[listingId];
        if (record.status == ListingStatus.Closed) revert ListingAlreadyClosed();
        if (_isContractChainBlocking(_activeContractByListing[listingId])) revert ListingBlockedByExistingContractChain();
        if (newContentHash == bytes32(0)) revert NewContentHashRequired();
        if (newRentAmountWei == 0) revert NewRentAmountWeiMustBePositive();
        if (newMinLeaseMonths == 0) revert NewMinLeaseMonthsMustBePositive();
        if (newSnapshotHash == bytes32(0)) revert NewSnapshotHashRequired();
        if (bytes(newSnapshotCid).length == 0) revert NewSnapshotCidRequired();
        _consumePermit(
            ACTION_UPDATE_LISTING_TERMS,
            msg.sender,
            _stringHash(listingId),
            _hashUpdateListingTermsParams(
                listingId,
                newContentHash,
                newRentAmountWei,
                newMinLeaseMonths,
                newImageRootHash,
                newSnapshotHash,
                newSnapshotCid,
                expectedVersion,
                expectedNonce
            ),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );
        if (record.version != expectedVersion) revert VersionMismatch();
        if (record.nonce != expectedNonce) revert NonceMismatch();

        record.contentHash = newContentHash;
        record.rentAmountWei = newRentAmountWei;
        record.minLeaseMonths = newMinLeaseMonths;
        record.imageRootHash = newImageRootHash;
        record.version += 1;
        record.nonce += 1;
        record.updatedAt = block.timestamp;

        emit ListingContentUpdated(listingId, newContentHash, newRentAmountWei, newMinLeaseMonths, newImageRootHash, record.version, record.nonce, msg.sender, block.timestamp);
        emit ListingSnapshotAnchored(listingId, record.version, newContentHash, newSnapshotHash, newSnapshotCid, block.timestamp);
    }

    function setListingStatus(
        string calldata listingId,
        ListingStatus newStatus,
        uint64 expectedVersion,
        uint64 expectedNonce,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external nonReentrant onlyLandlord(listingId) {
        ListingRecord storage record = _listings[listingId];
        if (_isContractChainBlocking(_activeContractByListing[listingId])) revert ListingBlockedByExistingContractChain();
        _consumePermit(
            ACTION_SET_LISTING_STATUS,
            msg.sender,
            _stringHash(listingId),
            _hashSetListingStatusParams(listingId, newStatus, expectedVersion, expectedNonce),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );
        if (record.version != expectedVersion) revert VersionMismatch();
        if (record.nonce != expectedNonce) revert NonceMismatch();

        ListingStatus oldStatus = record.status;
        if (oldStatus == ListingStatus.Closed) revert ListingAlreadyClosed();
        if (oldStatus == newStatus) revert StatusUnchanged();

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
        if (msg.sender != tenant) revert OnlyTenantCanLockEscrow();
        if (msg.value != capWei) revert EscrowValueMustEqualCapWei();
        if (capWei == 0) revert CapWeiMustBePositive();
        if (block.timestamp * 1000 > deadlineMs) revert AuthorizationExpired();

        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        if (auth.status != GasAuthStatus.None) revert AuthorizationAlreadyExists();

        bytes32 digest = _gasAuthDigest(contractId, contractContentHash, tenant, landlord, capWei, deadlineMs, nonce);
        address recovered = _recoverSigner(digest, signature);
        if (recovered != tenant) revert InvalidAuthorizationSignature();

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

    function revokeGasCompensationAuthorization(string calldata contractId, address tenant, bytes32 nonce) external nonReentrant {
        if (msg.sender != tenant) revert OnlyTenantCanRevoke();
        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        if (auth.status != GasAuthStatus.Active) revert OnlyActiveAuthorizationCanRevoke();

        auth.status = GasAuthStatus.Revoked;
        uint256 refundWei = auth.lockedWei;
        auth.lockedWei = 0;

        (bool ok, ) = tenant.call{value: refundWei}("");
        if (!ok) revert RefundFailed();
        emit GasCompRevoked(authId, contractId, tenant, refundWei);
    }

    function cancelPendingGasAuthorization(string calldata contractId, address tenant, bytes32 nonce) external nonReentrant {
        bytes32 authId = _gasAuthId(contractId, tenant, nonce);
        GasAuthorization storage auth = _gasAuths[authId];
        if (auth.tenant == address(0)) revert AuthorizationNotFound();
        if (msg.sender != auth.tenant && msg.sender != auth.landlord) revert OnlyContractParties();
        if (auth.status != GasAuthStatus.Active) {
            return;
        }

        auth.status = GasAuthStatus.Revoked;
        uint256 refundWei = auth.lockedWei;
        auth.lockedWei = 0;

        (bool ok, ) = auth.tenant.call{value: refundWei}("");
        if (!ok) revert RefundFailed();
        emit GasCompRevoked(authId, contractId, auth.tenant, refundWei);
    }

    function recordInitialRentPayment(
        string calldata contractId,
        address landlord,
        string calldata orderNo,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external payable nonReentrant {
        if (bytes(contractId).length == 0) revert ContractIdRequired();
        if (landlord == address(0)) revert InvalidLandlord();
        ContractRecord storage record = _contracts[contractId];
        if (!record.exists) revert ContractNotFound();
        if (msg.sender != record.tenant) revert OnlyTenantCanPay();
        _consumePermit(
            ACTION_RECORD_INITIAL_PAYMENT,
            msg.sender,
            _stringHash(contractId),
            _hashInitialPaymentParams(contractId, landlord, orderNo, msg.value),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );
        if (record.landlord != landlord) revert LandlordMismatch();
        if (record.status != ContractStatus.Created) revert ContractNotPayable();
        if (msg.value != record.initialAmountWei) revert InvalidPaymentAmount();
        if (block.timestamp * 1000 > _paymentDeadlineMs(record)) revert PaymentDeadlineExpired();

        if (bytes(record.parentContractId).length > 0) {
            ContractRecord storage parent = _contracts[record.parentContractId];
            if (!parent.exists) revert ParentContractNotFound();
            if (parent.status == ContractStatus.Cancelled || parent.status == ContractStatus.Completed) revert ParentContractUnavailable();
        }

        ContractStatus nextStatus = _isParentCurrentlyEffective(record.parentContractId)
            ? ContractStatus.Paid
            : ContractStatus.Active;
        record.status = nextStatus;
        uint256 platformFeeWei = (msg.value * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAfterPlatformFeeWei = msg.value - platformFeeWei;
        uint256 performanceGuaranteeWei = (netAfterPlatformFeeWei * PERFORMANCE_GUARANTEE_BPS) / BPS_DENOMINATOR;
        uint256 escrowWei = netAfterPlatformFeeWei - performanceGuaranteeWei;
        uint256 monthlyReleaseWei = record.leaseMonths > 0 ? (escrowWei / record.leaseMonths) : 0;
        record.performanceGuaranteeWei = performanceGuaranteeWei;
        record.escrowTotalWei = escrowWei;
        record.monthlyReleaseWei = monthlyReleaseWei;
        record.releasedWei = 0;
        record.refundedWei = 0;
        record.releasedPeriods = 0;
        record.terminatedAtMs = 0;
        if (platformFeeWei > 0) {
            (bool okFee, ) = platformFeeRecipient.call{value: platformFeeWei}("");
            if (!okFee) revert TransferFeeFailed();
        }
        if (performanceGuaranteeWei > 0) {
            (bool okGuarantee, ) = landlord.call{value: performanceGuaranteeWei}("");
            if (!okGuarantee) revert TransferGuaranteeFailed();
        }
        emit RentPaymentRecorded(contractId, msg.sender, landlord, msg.value, platformFeeWei, performanceGuaranteeWei, escrowWei, platformFeeRecipient, orderNo, block.timestamp);
        emit ContractStatusChanged(contractId, record.listingId, uint8(ContractStatus.Created), uint8(nextStatus), block.timestamp);
    }

    function releaseDueRent(string calldata contractId) external nonReentrant {
        ContractRecord storage record = _contracts[contractId];
        if (!record.exists) revert ContractNotFound();
        if (msg.sender != trustedSigner && msg.sender != record.landlord) revert OnlyReleaseManager();
        if (record.status != ContractStatus.Active && record.status != ContractStatus.Paid) revert ContractNotReleasable();
        if (record.escrowTotalWei <= record.releasedWei) revert EscrowAlreadyReleased();

        uint16 earnedPeriods = _earnedReleasePeriods(record);
        if (earnedPeriods <= record.releasedPeriods) revert NoReleasableRent();
        uint16 unreleasedPeriods = earnedPeriods - record.releasedPeriods;
        uint256 releaseAmountWei;
        if (earnedPeriods >= record.leaseMonths) {
            releaseAmountWei = record.escrowTotalWei - record.releasedWei;
        } else {
            releaseAmountWei = uint256(unreleasedPeriods) * record.monthlyReleaseWei;
        }
        if (releaseAmountWei == 0) revert ReleaseAmountZero();

        record.releasedPeriods = earnedPeriods;
        record.releasedWei += releaseAmountWei;
        if (record.status == ContractStatus.Paid && block.timestamp * 1000 >= record.startAtMs) {
            record.status = ContractStatus.Active;
        }
        (bool ok, ) = record.landlord.call{value: releaseAmountWei}("");
        if (!ok) revert ReleaseTransferFailed();
        emit RentReleased(contractId, record.listingId, record.landlord, record.releasedPeriods, releaseAmountWei, record.releasedWei, block.timestamp);
    }

    function terminateContractEarly(string calldata contractId) external nonReentrant {
        ContractRecord storage record = _contracts[contractId];
        if (!record.exists) revert ContractNotFound();
        if (msg.sender != record.tenant) revert OnlyTenantCanTerminate();
        if (record.status != ContractStatus.Active && record.status != ContractStatus.Paid) revert ContractNotTerminable();

        uint256 terminatedAtMs = block.timestamp * 1000;
        uint256 earnedEscrowWei = _earnedEscrowWeiAt(record, terminatedAtMs);
        uint256 landlordSettledWei = 0;
        if (earnedEscrowWei > record.releasedWei) {
            landlordSettledWei = earnedEscrowWei - record.releasedWei;
        }
        uint256 remainingEscrowWei = record.escrowTotalWei - record.releasedWei;
        uint256 refundWei = remainingEscrowWei - landlordSettledWei;
        if (landlordSettledWei > 0) {
            record.releasedWei += landlordSettledWei;
        }
        record.refundedWei = refundWei;
        record.terminatedAtMs = terminatedAtMs;
        ContractStatus oldStatus = record.status;
        record.status = ContractStatus.Cancelled;

        if (landlordSettledWei > 0) {
            (bool okLandlord, ) = record.landlord.call{value: landlordSettledWei}("");
            if (!okLandlord) revert ReleaseTransferFailed();
        }
        if (refundWei > 0) {
            (bool ok, ) = record.tenant.call{value: refundWei}("");
            if (!ok) revert TenantRefundTransferFailed();
        }
        _cancelFutureRenewalChildOnParentTermination(record, terminatedAtMs);
        emit ContractEarlyTerminated(contractId, record.listingId, record.tenant, landlordSettledWei, refundWei, record.terminatedAtMs);
        emit ContractStatusChanged(contractId, record.listingId, uint8(oldStatus), uint8(ContractStatus.Cancelled), block.timestamp);
    }

    function submitRentalReview(
        string calldata contractId,
        bytes32 commentHash,
        uint8 rating,
        string calldata commentCid,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external {
        if (bytes(contractId).length == 0) revert ContractIdRequired();
        if (commentHash == bytes32(0)) revert CommentHashRequired();
        if (rating < 1 || rating > 5) revert RatingOutOfRange();
        if (bytes(commentCid).length == 0) revert CommentCidRequired();
        _consumePermit(
            ACTION_SUBMIT_RENTAL_REVIEW,
            msg.sender,
            _stringHash(contractId),
            _hashRentalReviewParams(contractId, commentHash, rating, commentCid),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );

        ContractRecord storage record = _contracts[contractId];
        if (!record.exists) revert ContractNotFound();
        if (msg.sender != record.tenant) revert OnlyTenantCanReview();
        if (
            record.status != ContractStatus.Active
            && record.status != ContractStatus.Completed
            && record.status != ContractStatus.Cancelled
        ) revert ContractNotReviewable();
        uint256 reviewAnchorMs = record.status == ContractStatus.Cancelled ? record.terminatedAtMs : record.endAtMs;
        if (reviewAnchorMs == 0 || block.timestamp * 1000 < reviewAnchorMs) revert ReviewNotOpen();
        if (block.timestamp * 1000 > reviewAnchorMs + REVIEW_WINDOW_MS * 1000) revert ReviewWindowClosed();

        RentalReview storage review = _rentalReviews[contractId];
        if (review.exists) revert ReviewAlreadySubmitted();

        review.exists = true;
        review.rating = rating;
        review.commentHash = commentHash;
        review.ratedAt = uint64(block.timestamp);
        review.tenant = msg.sender;

        emit RentalReviewSubmitted(contractId, record.listingId, msg.sender, rating, commentHash, commentCid, block.timestamp);
    }

    function submitListingFeedback(
        string calldata listingId,
        uint8 feedbackType,
        bytes32 commentHash,
        string calldata commentCid,
        bytes32 permitNonce,
        uint256 permitDeadlineMs,
        bytes calldata permitSignature
    ) external {
        if (bytes(listingId).length == 0) revert ListingIdRequired();
        if (commentHash == bytes32(0)) revert CommentHashRequired();
        if (feedbackType < 1 || feedbackType > 5) revert FeedbackTypeOutOfRange();
        if (bytes(commentCid).length == 0) revert CommentCidRequired();
        _consumePermit(
            ACTION_SUBMIT_LISTING_FEEDBACK,
            msg.sender,
            _stringHash(listingId),
            _hashListingFeedbackParams(listingId, feedbackType, commentHash, commentCid),
            permitNonce,
            permitDeadlineMs,
            permitSignature
        );

        ListingRecord storage listing = _listings[listingId];
        if (!listing.exists) revert ListingNotFound();

        emit ListingFeedbackSubmitted(listingId, msg.sender, feedbackType, commentHash, commentCid, block.timestamp);
    }

    function completeExpiredContract(string calldata contractId) external {
        ContractRecord storage record = _contracts[contractId];
        if (!record.exists) revert ContractNotFound();
        if (record.status != ContractStatus.Active) revert ContractNotActive();
        if (record.endAtMs == 0 || block.timestamp * 1000 < record.endAtMs) revert ContractNotExpired();

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

    function getContractChainHeadByListing(string calldata listingId) external view returns (string memory headContractId) {
        return _activeContractByListing[listingId];
    }

    function getCurrentEffectiveContractByListing(string calldata listingId) external view returns (string memory currentContractId) {
        string memory headContractId = _activeContractByListing[listingId];
        return _findCurrentEffectiveContractIdFromHead(headContractId);
    }

    function getRentalReview(string calldata contractId) external view returns (RentalReview memory review) {
        review = _rentalReviews[contractId];
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
