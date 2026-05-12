// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CampusTrade {
    enum OrderStatus { Pending, Paid, Shipped, Received, Completed, Cancelled, Disputed, Refunded }

    struct Product {
        uint256 id;
        address seller;
        string title;
        string description;
        uint256 price;
        string category;
        string imageUrl;
        bool isActive;
        uint256 createdAt;
    }

    struct Order {
        uint256 id;
        uint256 productId;
        address buyer;
        address seller;
        uint256 price;
        OrderStatus status;
        string shippingInfo;
        string disputeReason;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct UserInfo {
        bool isRegistered;
        string nickname;
        string contactInfo;
        uint256 totalSales;
        uint256 totalPurchases;
        uint256 ratingSum;
        uint256 ratingCount;
        bool isFrozen;
    }

    address public owner;
    uint256 public productCounter;
    uint256 public orderCounter;
    uint256 public platformFeePercent = 1;

    mapping(uint256 => Product) public products;
    mapping(uint256 => Order) public orders;
    mapping(address => UserInfo) public users;
    mapping(uint256 => mapping(address => bool)) public productRatings;

    uint256[] private _allProductIds;

    event UserRegistered(address indexed user, string nickname, string contactInfo);
    event ProductListed(uint256 indexed productId, address indexed seller, string title, uint256 price);
    event ProductUpdated(uint256 indexed productId, string title, uint256 price);
    event ProductRemoved(uint256 indexed productId);
    event OrderCreated(uint256 indexed orderId, uint256 indexed productId, address indexed buyer, uint256 price);
    event OrderPaid(uint256 indexed orderId);
    event OrderShipped(uint256 indexed orderId, string shippingInfo);
    event OrderReceived(uint256 indexed orderId);
    event OrderCompleted(uint256 indexed orderId);
    event OrderCancelled(uint256 indexed orderId);
    event OrderDisputed(uint256 indexed orderId, string reason);
    event OrderRefunded(uint256 indexed orderId);
    event RatingGiven(uint256 indexed productId, address indexed user, uint8 rating);

    modifier onlyOwner() {
        require(msg.sender == owner, unicode"只有合约拥有者可以调用");
        _;
    }

    modifier onlyRegistered() {
        require(users[msg.sender].isRegistered, unicode"用户未注册");
        require(!users[msg.sender].isFrozen, unicode"账户已被冻结");
        _;
    }

    modifier onlySeller(uint256 _productId) {
        require(products[_productId].seller == msg.sender, unicode"只有卖家可以操作");
        _;
    }

    modifier onlyBuyer(uint256 _orderId) {
        require(orders[_orderId].buyer == msg.sender, unicode"只有买家可以操作");
        _;
    }

    modifier productExists(uint256 _productId) {
        require(_productId > 0 && _productId <= productCounter, unicode"商品不存在");
        _;
    }

    modifier orderExists(uint256 _orderId) {
        require(_orderId > 0 && _orderId <= orderCounter, unicode"订单不存在");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ========== User Management ==========

    function registerUser(string calldata _nickname, string calldata _contactInfo) external {
        require(!users[msg.sender].isRegistered, unicode"用户已注册");
        require(bytes(_nickname).length > 0, unicode"昵称不能为空");

        users[msg.sender] = UserInfo({
            isRegistered: true,
            nickname: _nickname,
            contactInfo: _contactInfo,
            totalSales: 0,
            totalPurchases: 0,
            ratingSum: 0,
            ratingCount: 0,
            isFrozen: false
        });

        emit UserRegistered(msg.sender, _nickname, _contactInfo);
    }

    function updateUserInfo(string calldata _nickname, string calldata _contactInfo) external onlyRegistered {
        users[msg.sender].nickname = _nickname;
        users[msg.sender].contactInfo = _contactInfo;
    }

    // ========== Product Management ==========

    function listProduct(
        string calldata _title,
        string calldata _description,
        uint256 _price,
        string calldata _category,
        string calldata _imageUrl
    ) external onlyRegistered returns (uint256) {
        require(bytes(_title).length > 0, unicode"标题不能为空");
        require(_price > 0, unicode"价格必须大于 0");
        require(_price <= 1000 ether, unicode"价格过高");

        productCounter++;
        uint256 newId = productCounter;

        products[newId] = Product({
            id: newId,
            seller: msg.sender,
            title: _title,
            description: _description,
            price: _price,
            category: _category,
            imageUrl: _imageUrl,
            isActive: true,
            createdAt: block.timestamp
        });

        _allProductIds.push(newId);

        emit ProductListed(newId, msg.sender, _title, _price);
        return newId;
    }

    function updateProduct(
        uint256 _productId,
        string calldata _title,
        string calldata _description,
        uint256 _price,
        string calldata _category,
        string calldata _imageUrl
    ) external productExists(_productId) onlySeller(_productId) {
        Product storage product = products[_productId];
        require(product.isActive, unicode"商品已下架");

        product.title = _title;
        product.description = _description;
        product.price = _price;
        product.category = _category;
        product.imageUrl = _imageUrl;

        emit ProductUpdated(_productId, _title, _price);
    }

    function removeProduct(uint256 _productId) external productExists(_productId) onlySeller(_productId) {
        products[_productId].isActive = false;
        emit ProductRemoved(_productId);
    }

    // ========== Order Management (Escrow) ==========

    function createOrder(uint256 _productId)
        external
        payable
        productExists(_productId)
        onlyRegistered
        returns (uint256)
    {
        Product storage product = products[_productId];
        require(product.isActive, unicode"商品已下架");
        require(product.seller != msg.sender, unicode"不能购买自己的商品");
        require(msg.value == product.price, unicode"支付金额不正确");

        orderCounter++;
        uint256 newOrderId = orderCounter;
        product.isActive = false;

        orders[newOrderId] = Order({
            id: newOrderId,
            productId: _productId,
            buyer: msg.sender,
            seller: product.seller,
            price: msg.value,
            status: OrderStatus.Paid,
            shippingInfo: "",
            disputeReason: "",
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        emit OrderCreated(newOrderId, _productId, msg.sender, msg.value);
        emit OrderPaid(newOrderId);

        return newOrderId;
    }

    function shipOrder(uint256 _orderId, string calldata _shippingInfo) external orderExists(_orderId) {
        Order storage order = orders[_orderId];
        require(order.seller == msg.sender, unicode"只有卖家可以发货");
        require(order.status == OrderStatus.Paid, unicode"订单状态错误");

        order.status = OrderStatus.Shipped;
        order.shippingInfo = _shippingInfo;
        order.updatedAt = block.timestamp;

        emit OrderShipped(_orderId, _shippingInfo);
    }

    function confirmReceived(uint256 _orderId) external orderExists(_orderId) onlyBuyer(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Shipped, unicode"订单状态错误");

        order.status = OrderStatus.Completed;
        order.updatedAt = block.timestamp;

        uint256 fee = (order.price * platformFeePercent) / 100;
        uint256 sellerAmount = order.price - fee;

        users[order.seller].totalSales += sellerAmount;
        users[order.buyer].totalPurchases += order.price;

        payable(order.seller).transfer(sellerAmount);

        emit OrderCompleted(_orderId);
    }

    function cancelOrder(uint256 _orderId) external orderExists(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Paid, unicode"只能取消未发货的订单");
        require(order.buyer == msg.sender, unicode"只有买家可以取消");

        order.status = OrderStatus.Cancelled;
        order.updatedAt = block.timestamp;

        payable(order.buyer).transfer(order.price);
        products[order.productId].isActive = true;

        emit OrderCancelled(_orderId);
    }

    function disputeOrder(uint256 _orderId, string calldata _reason) external orderExists(_orderId) {
        Order storage order = orders[_orderId];
        require(
            msg.sender == order.buyer || msg.sender == order.seller,
            unicode"只有买卖双方可以发起纠纷"
        );
        require(
            order.status == OrderStatus.Paid || order.status == OrderStatus.Shipped,
            unicode"当前状态不可发起纠纷"
        );

        order.status = OrderStatus.Disputed;
        order.disputeReason = _reason;
        order.updatedAt = block.timestamp;

        emit OrderDisputed(_orderId, _reason);
    }

    function resolveDisputeRefund(uint256 _orderId) external onlyOwner orderExists(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Disputed, unicode"订单未处于纠纷状态");

        order.status = OrderStatus.Refunded;
        order.updatedAt = block.timestamp;

        payable(order.buyer).transfer(order.price);
        products[order.productId].isActive = true;

        emit OrderRefunded(_orderId);
    }

    function resolveDisputeRelease(uint256 _orderId) external onlyOwner orderExists(_orderId) {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Disputed, unicode"订单未处于纠纷状态");

        order.status = OrderStatus.Completed;
        order.updatedAt = block.timestamp;

        uint256 fee = (order.price * platformFeePercent) / 100;
        uint256 sellerAmount = order.price - fee;

        payable(order.seller).transfer(sellerAmount);

        emit OrderCompleted(_orderId);
    }

    // ========== Rating System ==========

    function rateProduct(uint256 _productId, uint8 _rating) external productExists(_productId) onlyRegistered {
        require(_rating >= 1 && _rating <= 5, unicode"评分必须在 1-5 之间");
        require(!productRatings[_productId][msg.sender], unicode"已经评价过该商品");

        productRatings[_productId][msg.sender] = true;
        users[products[_productId].seller].ratingSum += _rating;
        users[products[_productId].seller].ratingCount++;

        emit RatingGiven(_productId, msg.sender, _rating);
    }

    // ========== Platform Management ==========

    function setPlatformFee(uint256 _feePercent) external onlyOwner {
        require(_feePercent <= 10, unicode"手续费不能超过 10%");
        platformFeePercent = _feePercent;
    }

    function freezeUser(address _user, bool _frozen) external onlyOwner {
        require(users[_user].isRegistered, unicode"用户未注册");
        users[_user].isFrozen = _frozen;
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, unicode"余额为 0");
        payable(owner).transfer(balance);
    }

    // ========== Query Functions ==========

    function getProductCount() external view returns (uint256) {
        return productCounter;
    }

    function getAllProducts() external view returns (Product[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _allProductIds.length; i++) {
            if (products[_allProductIds[i]].isActive) activeCount++;
        }

        Product[] memory activeProducts = new Product[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < _allProductIds.length; i++) {
            if (products[_allProductIds[i]].isActive) {
                activeProducts[index] = products[_allProductIds[i]];
                index++;
            }
        }
        return activeProducts;
    }

    function getProductsByCategory(string calldata _category) external view returns (Product[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _allProductIds.length; i++) {
            Product storage p = products[_allProductIds[i]];
            if (p.isActive && keccak256(bytes(p.category)) == keccak256(bytes(_category))) count++;
        }

        Product[] memory result = new Product[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < _allProductIds.length; i++) {
            Product storage p = products[_allProductIds[i]];
            if (p.isActive && keccak256(bytes(p.category)) == keccak256(bytes(_category))) {
                result[index] = p;
                index++;
            }
        }
        return result;
    }

    function getProductsBySeller(address _seller) external view returns (Product[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _allProductIds.length; i++) {
            if (products[_allProductIds[i]].seller == _seller) count++;
        }

        Product[] memory result = new Product[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < _allProductIds.length; i++) {
            if (products[_allProductIds[i]].seller == _seller) {
                result[index] = products[_allProductIds[i]];
                index++;
            }
        }
        return result;
    }

    function getOrdersByBuyer(address _buyer) external view returns (Order[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= orderCounter; i++) {
            if (orders[i].buyer == _buyer) count++;
        }

        Order[] memory result = new Order[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= orderCounter; i++) {
            if (orders[i].buyer == _buyer) {
                result[index] = orders[i];
                index++;
            }
        }
        return result;
    }

    function getOrdersBySeller(address _seller) external view returns (Order[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= orderCounter; i++) {
            if (orders[i].seller == _seller) count++;
        }

        Order[] memory result = new Order[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= orderCounter; i++) {
            if (orders[i].seller == _seller) {
                result[index] = orders[i];
                index++;
            }
        }
        return result;
    }

    function getUserRating(address _user) external view returns (uint256, uint256) {
        UserInfo storage u = users[_user];
        if (u.ratingCount == 0) return (0, 0);
        return (u.ratingSum / u.ratingCount, u.ratingCount);
    }

    receive() external payable {}
}
