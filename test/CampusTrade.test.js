const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CampusTrade - 校园二手交易平台", function () {
  let CampusTrade, contract;
  let owner, seller, buyer, other;

  beforeEach(async function () {
    [owner, seller, buyer, other] = await ethers.getSigners();

    CampusTrade = await ethers.getContractFactory("CampusTrade");
    contract = await CampusTrade.deploy();
    await contract.waitForDeployment();
  });

  describe("用户注册", function () {
    it("应该允许用户注册", async function () {
      await contract.connect(seller).registerUser("张三", "微信: zhangsan");
      const user = await contract.users(seller.address);
      expect(user.isRegistered).to.be.true;
      expect(user.nickname).to.equal("张三");
    });

    it("不应允许重复注册", async function () {
      await contract.connect(seller).registerUser("张三", "微信: zhangsan");
      await expect(
        contract.connect(seller).registerUser("李四", "微信: lisi")
      ).to.be.revertedWith("用户已注册");
    });
  });

  describe("商品管理", function () {
    beforeEach(async function () {
      await contract.connect(seller).registerUser("卖家", "seller@test.com");
      await contract.connect(buyer).registerUser("买家", "buyer@test.com");
    });

    it("应该允许卖家发布商品", async function () {
      const tx = await contract.connect(seller).listProduct(
        "二手课本",
        "九成新高等数学教材",
        ethers.parseEther("0.01"),
        "教材",
        "https://example.com/book.jpg"
      );
      await tx.wait();

      const product = await contract.products(1);
      expect(product.title).to.equal("二手课本");
      expect(product.price).to.equal(ethers.parseEther("0.01"));
      expect(product.isActive).to.be.true;
    });

    it("应允许卖家更新商品", async function () {
      await contract.connect(seller).listProduct(
        "二手课本", "九成新", ethers.parseEther("0.01"), "教材", ""
      );
      await contract.connect(seller).updateProduct(
        1, "二手课本-降价", "保护得很好", ethers.parseEther("0.005"), "教材", ""
      );
      const product = await contract.products(1);
      expect(product.price).to.equal(ethers.parseEther("0.005"));
    });

    it("应允许卖家下架商品", async function () {
      await contract.connect(seller).listProduct(
        "二手课本", "九成新", ethers.parseEther("0.01"), "教材", ""
      );
      await contract.connect(seller).removeProduct(1);
      const product = await contract.products(1);
      expect(product.isActive).to.be.false;
    });
  });

  describe("订单交易", function () {
    beforeEach(async function () {
      await contract.connect(seller).registerUser("卖家", "seller@test.com");
      await contract.connect(buyer).registerUser("买家", "buyer@test.com");
      await contract.connect(seller).listProduct(
        "二手手机", "iPhone 12 95新", ethers.parseEther("0.1"), "数码", ""
      );
    });

    it("应允许买家购买商品（锁定资金）", async function () {
      const price = ethers.parseEther("0.1");
      await contract.connect(buyer).createOrder(1, { value: price });
      const order = await contract.orders(1);
      expect(order.status).to.equal(1); // Paid
      expect(order.buyer).to.equal(buyer.address);
    });

    it("不应允许卖家购买自己的商品", async function () {
      await expect(
        contract.connect(seller).createOrder(1, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("不能购买自己的商品");
    });

    it("应支持完整的交易流程", async function () {
      const price = ethers.parseEther("0.1");

      // 1. 买家购买
      await contract.connect(buyer).createOrder(1, { value: price });

      // 2. 卖家发货
      await contract.connect(seller).shipOrder(1, "顺丰快递 SF123456");
      let order = await contract.orders(1);
      expect(order.status).to.equal(2); // Shipped

      // 3. 买家确认收货
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      await contract.connect(buyer).confirmReceived(1);
      order = await contract.orders(1);
      expect(order.status).to.equal(4); // Completed

      // 4. 验证卖家收到款项（扣除1%手续费）
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
      const expectedAmount = (price * BigInt(99)) / BigInt(100);
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(expectedAmount);
    });

    it("应允许买家在发货前取消订单", async function () {
      const price = ethers.parseEther("0.1");
      await contract.connect(buyer).createOrder(1, { value: price });

      const tx = await contract.connect(buyer).cancelOrder(1);
      await tx.wait();

      const order = await contract.orders(1);
      expect(order.status).to.equal(5); // Cancelled

      // 验证商品重新上架
      const product = await contract.products(1);
      expect(product.isActive).to.be.true;
    });
  });

  describe("纠纷处理", function () {
    beforeEach(async function () {
      await contract.connect(seller).registerUser("卖家", "seller@test.com");
      await contract.connect(buyer).registerUser("买家", "buyer@test.com");
      await contract.connect(seller).listProduct(
        "二手耳机", "AirPods Pro", ethers.parseEther("0.05"), "数码", ""
      );
      await contract.connect(buyer).createOrder(1, { value: ethers.parseEther("0.05") });
    });

    it("应允许发起纠纷", async function () {
      await contract.connect(buyer).disputeOrder(1, "商品与描述不符");
      const order = await contract.orders(1);
      expect(order.status).to.equal(6); // Disputed
    });

    it("管理员应能退款给买家", async function () {
      await contract.connect(buyer).disputeOrder(1, "商品有问题");
      await contract.connect(owner).resolveDisputeRefund(1);
      const order = await contract.orders(1);
      expect(order.status).to.equal(7); // Refunded
    });
  });

  describe("评价系统", function () {
    beforeEach(async function () {
      await contract.connect(seller).registerUser("卖家", "seller@test.com");
      await contract.connect(buyer).registerUser("买家", "buyer@test.com");
      await contract.connect(seller).listProduct(
        "测试商品", "描述", ethers.parseEther("0.01"), "其他", ""
      );
      await contract.connect(buyer).createOrder(1, { value: ethers.parseEther("0.01") });
      await contract.connect(seller).shipOrder(1, "快递");
      await contract.connect(buyer).confirmReceived(1);
    });

    it("应允许买家评分", async function () {
      await contract.connect(buyer).rateProduct(1, 5);
      const result = await contract.getUserRating(seller.address);
      const count = Number(result[1]);
      expect(count).to.equal(1);
    });
  });
});
