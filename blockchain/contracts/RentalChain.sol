// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RentalChain
 * @notice 房源上链主合约（重构版）
 */
contract RentalChain {
    // 函数 1: 房源状态枚举。
    enum ListingStatus {
        Active,
        Locked,
        Rented,
        Offline,
        Closed
    }

    // 函数 2: 房源上链记录。
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

    // 函数 3: 按 listingId 存储房源记录。
    mapping(string => ListingRecord) private _listings;
    string[] private _allListingIds;

    // 函数 4: 房源创建事件。
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

    // 函数 5: 房源内容更新事件。
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

    // 函数 6: 房源状态更新事件。
    event ListingStatusChanged(
        string indexed listingId,
        uint8 oldStatus,
        uint8 newStatus,
        uint64 version,
        uint64 nonce,
        address indexed operator,
        uint256 blockTime
    );

    // 函数 7: 校验调用者为房源所属房东。
    modifier onlyLandlord(string calldata listingId) {
        require(_listings[listingId].exists, unicode"房源不存在");
        require(_listings[listingId].landlord == msg.sender, unicode"仅房东可操作");
        _;
    }

    // 函数 8: 创建房源（完整字段）。
    function createListing(
        string calldata listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash
    ) external {
        _createListing(listingId, contentHash, rentAmountWei, minLeaseMonths, imageRootHash);
    }

    // 函数 8-1: 创建房源内部实现。
    function _createListing(
        string memory listingId,
        bytes32 contentHash,
        uint256 rentAmountWei,
        uint16 minLeaseMonths,
        bytes32 imageRootHash
    ) internal {
        require(bytes(listingId).length > 0, unicode"listingId 不能为空");
        require(!_listings[listingId].exists, unicode"房源ID已存在");
        require(contentHash != bytes32(0), unicode"contentHash 不能为空");
        require(rentAmountWei > 0, unicode"rentAmountWei 必须大于0");
        require(minLeaseMonths > 0, unicode"minLeaseMonths 必须大于0");

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

        emit ListingCreated(
            listingId,
            msg.sender,
            contentHash,
            rentAmountWei,
            minLeaseMonths,
            imageRootHash,
            record.version,
            record.nonce,
            block.timestamp
        );
    }

    // 函数 9: 兼容旧接口（仅写入 listingId，其他字段使用默认最小值）。
    function storeListing(string calldata listingId) external {
        _createListing(listingId, keccak256(abi.encodePacked(listingId, msg.sender)), 1, 1, bytes32(0));
    }

    // 函数 10: 更新房源可变字段（内容锚点、租金、最少租期、图片根哈希）。
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
        require(record.status != ListingStatus.Closed, unicode"已关闭房源不可修改");
        require(newContentHash != bytes32(0), unicode"newContentHash 不能为空");
        require(newRentAmountWei > 0, unicode"newRentAmountWei 必须大于0");
        require(newMinLeaseMonths > 0, unicode"newMinLeaseMonths 必须大于0");
        require(record.version == expectedVersion, unicode"version 不匹配");
        require(record.nonce == expectedNonce, unicode"nonce 不匹配");

        record.contentHash = newContentHash;
        record.rentAmountWei = newRentAmountWei;
        record.minLeaseMonths = newMinLeaseMonths;
        record.imageRootHash = newImageRootHash;
        record.version += 1;
        record.nonce += 1;
        record.updatedAt = block.timestamp;

        emit ListingContentUpdated(
            listingId,
            newContentHash,
            newRentAmountWei,
            newMinLeaseMonths,
            newImageRootHash,
            record.version,
            record.nonce,
            msg.sender,
            block.timestamp
        );
    }

    // 函数 11: 更新房源状态（Active/Offline/Closed）。
    function setListingStatus(
        string calldata listingId,
        ListingStatus newStatus,
        uint64 expectedVersion,
        uint64 expectedNonce
    ) external onlyLandlord(listingId) {
        ListingRecord storage record = _listings[listingId];
        require(record.version == expectedVersion, unicode"version 不匹配");
        require(record.nonce == expectedNonce, unicode"nonce 不匹配");

        ListingStatus oldStatus = record.status;
        require(oldStatus != ListingStatus.Closed, unicode"已关闭房源不可变更状态");
        require(oldStatus != newStatus, unicode"状态未变化");

        // Closed 为终态。
        record.status = newStatus;
        record.version += 1;
        record.nonce += 1;
        record.updatedAt = block.timestamp;

        emit ListingStatusChanged(
            listingId,
            uint8(oldStatus),
            uint8(newStatus),
            record.version,
            record.nonce,
            msg.sender,
            block.timestamp
        );
    }

    // 函数 12: 查询房源详情。
    function getListing(string calldata listingId)
        external
        view
        returns (
            string memory outListingId,
            address landlord,
            bytes32 contentHash,
            uint256 rentAmountWei,
            uint16 minLeaseMonths,
            bytes32 imageRootHash,
            uint8 status,
            uint64 version,
            uint64 nonce,
            uint256 createdAt,
            uint256 updatedAt,
            bool exists
        )
    {
        ListingRecord storage record = _listings[listingId];
        return (
            record.listingId,
            record.landlord,
            record.contentHash,
            record.rentAmountWei,
            record.minLeaseMonths,
            record.imageRootHash,
            uint8(record.status),
            record.version,
            record.nonce,
            record.createdAt,
            record.updatedAt,
            record.exists
        );
    }

    // 函数 13: 查询房源总数。
    function getListingCount() external view returns (uint256) {
        return _allListingIds.length;
    }
}
