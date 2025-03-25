import { Address, encodeFunctionData, getAddress, toHex } from "tevm";
import { padHex } from "viem";
import { describe, expect, it } from "vitest";

import { ACCOUNTS, CONTRACTS } from "@test/constants";
import { getClient, getMappingSlotHex, getSlotHex } from "@test/utils";
import { traceStorageAccess } from "@/index";

const { Arrays, Mappings } = CONTRACTS;
const { caller, recipient } = ACCOUNTS;

/**
 * Data Structures Storage Access Tests
 *
 * This test suite verifies:
 *
 * 1. Simple and nested mapping slot access
 * 2. Mapping with struct values
 * 3. Complex mapping operations with storage updates
 * 4. Fixed and dynamic array storage access patterns
 * 5. Array length slot access and element storage
 * 6. Struct arrays with complex data storage layout
 * 7. Nested array storage patterns
 */
// TODO: structs (inside mappings & arrays as well)
describe("Data Structures Storage Access", () => {
  describe("Mappings", () => {
    it("should trace simple mapping slot access", async () => {
      const client = getClient();
      const user = recipient.toString();
      const amount = 1000n;

      // Set a value in the balances mapping
      const writeTrace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        abi: Mappings.abi,
        functionName: "setBalance",
        args: [user, amount],
      });

      // Verify the write operation was captured
      expect(writeTrace[Mappings.address].reads).toEqual({});
      expect(writeTrace[Mappings.address].writes).toEqual({
        [getMappingSlotHex(0, user)]: [
          {
            label: "balances",
            type: "uint256",
            current: { hex: "0x00", decoded: 0n },
            next: { hex: toHex(amount, { size: 32 }), decoded: amount },
            keys: [{ hex: padHex(user, { size: 32 }), decoded: user, type: "address" }],
          },
        ],
      });

      // Read the value and check if the same slot is accessed
      const readTrace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        abi: Mappings.abi,
        functionName: "getBalance",
        args: [user],
      });

      expect(readTrace[Mappings.address].writes).toEqual({});
      expect(readTrace[Mappings.address].reads).toEqual({
        [getMappingSlotHex(0, user)]: [
          {
            label: "balances",
            type: "uint256",
            current: { hex: toHex(amount, { size: 32 }), decoded: amount },
            keys: [{ hex: padHex(user, { size: 32 }), decoded: user, type: "address" }],
          },
        ],
      });
    });

    it("should trace nested mapping slot access", async () => {
      const client = getClient();
      const owner = caller.toString();
      const spender = recipient.toString();
      const amount = 1000n;

      // Set an allowance (nested mapping)
      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        abi: Mappings.abi,
        functionName: "setAllowance",
        args: [owner, spender, amount],
      });

      // Verify the write operation
      expect(trace[Mappings.address].reads).toEqual({});
      expect(trace[Mappings.address].writes).toEqual({
        [getMappingSlotHex(1, owner, spender)]: [
          {
            label: "allowances",
            type: "uint256",
            current: { hex: "0x00", decoded: 0n },
            next: { hex: toHex(amount, { size: 32 }), decoded: amount },
            keys: [
              { hex: padHex(owner, { size: 32 }), decoded: owner, type: "address" },
              { hex: padHex(spender, { size: 32 }), decoded: spender, type: "address" },
            ],
          },
        ],
      });
    });

    it("... even with a ridiculously nested mapping", async () => {
      const client = getClient();
      const [a, b, c, d] = Array.from(
        { length: 4 },
        (_, i) => `0xad${i.toString().repeat(38)}`.toLowerCase() as Address,
      );
      const value = 1000n;

      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        abi: Mappings.abi,
        functionName: "setRidiculouslyNestedMapping",
        args: [a, b, c, d, value],
      });

      expect(trace[Mappings.address].reads).toEqual({});
      expect(trace[Mappings.address].writes).toEqual({
        [getMappingSlotHex(2, a, b, c, d)]: [
          {
            label: "ridiculouslyNestedMapping",
            type: "uint256",
            current: { hex: "0x00", decoded: 0n },
            next: { hex: toHex(value, { size: 32 }), decoded: value },
            keys: [
              { hex: padHex(a, { size: 32 }), decoded: getAddress(a), type: "address" },
              { hex: padHex(b, { size: 32 }), decoded: getAddress(b), type: "address" },
              { hex: padHex(c, { size: 32 }), decoded: getAddress(c), type: "address" },
              { hex: padHex(d, { size: 32 }), decoded: getAddress(d), type: "address" },
            ],
          },
        ],
      });
    });

    it.only("should trace mapping with struct values slot access", async () => {
      const client = getClient();
      const user = recipient.toString();
      const balance = 2000n;
      const lastUpdate = 123456n;
      const isActive = true;

      // Set a struct in the userInfo mapping
      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        abi: Mappings.abi,
        functionName: "setUserInfo",
        args: [user, balance, lastUpdate, isActive],
      });

      // Verify no reads and multiple writes (one for each struct field)
      expect(trace[Mappings.address].reads).toEqual({});
      console.log(trace[Mappings.address].writes);
      console.log(
        JSON.stringify(trace[Mappings.address].writes, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
      );
    });

    it("should trace complex mapping operations with multiple keys", async () => {
      const client = getClient();
      const user = recipient.toString();

      // First set up the initial struct
      await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        data: encodeFunctionData(Mappings.write.setUserInfo(user, 100n, 100n, true)),
      });

      // Now update just the balance field
      const newBalance = 300n;
      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Mappings.address,
        data: encodeFunctionData(Mappings.write.updateUserBalance(user, newBalance)),
      });

      // We should see writes to both balance and lastUpdate fields, but not isActive
      expect(trace[Mappings.address].reads).toEqual({});
      expect(Object.keys(trace[Mappings.address].writes).length).toBe(2);

      const slots = Object.keys(trace[Mappings.address].writes);

      // Check the balance field update
      const balanceSlot = slots[0];
      expect(trace[Mappings.address].writes[balanceSlot][0]).toEqual({
        label: "userInfo[0x0000000000000000000000000000000000000002].balance",
        current: 100n,
        next: newBalance,
        type: "uint256",
        keys: [recipient.toString()],
        keySources: [expect.anything()],
      });

      // Check the lastUpdate field update
      const lastUpdateSlot = slots[1];
      expect(trace[Mappings.address].writes[lastUpdateSlot][0]).toEqual({
        label: "userInfo[0x0000000000000000000000000000000000000002].lastUpdate",
        current: 100n,
        next: expect.any(BigInt), // Block timestamp, which will be greater than 100
        type: "uint256",
        keys: [recipient.toString()],
        keySources: [expect.anything()],
      });

      // The isActive field should not be updated
      expect(slots.length).toBe(2);
    });
  });

  describe("Arrays", () => {
    it("should trace fixed array slot access", async () => {
      const client = getClient();
      const index = 2;
      const value = 42n;

      // Set a value in a fixed-size array at index 2
      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.setFixedArrayValue(index, value)),
      });

      // Fixed array slots are at baseSlot + index
      const expectedSlot = getSlotHex(0 + index); // First variable (fixedArray) starts at slot 0

      // Verify the write operation was captured
      expect(trace[Arrays.address].reads).toEqual({});
      expect(trace[Arrays.address].writes).toEqual({
        [expectedSlot]: [
          {
            label: "fixedArray[2]",
            current: 0n,
            next: 42n,
            type: "uint256",
          },
        ],
      });
    });

    it("should trace dynamic array length slot access when pushing elements", async () => {
      const client = getClient();
      const value = 123n;

      // Push a value to the dynamic array
      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.pushToDynamicArray(value)),
      });

      // Dynamic arrays store their length at the base slot
      const lengthSlot = getSlotHex(5); // fixedArray takes 0-4, dynamicArray is at 5

      // Verify the length slot was updated and an element was stored
      // We can't predict the exact hash-based slot for the element, so we'll check it exists
      expect(Object.keys(trace[Arrays.address].writes).length).toBe(2);
      expect(trace[Arrays.address].writes).toHaveProperty(lengthSlot);

      // Check the length slot update (0 to 1)
      expect(trace[Arrays.address].writes[lengthSlot][0]).toEqual({
        label: "dynamicArray.length",
        current: 0n,
        next: 1n,
        type: "uint256",
      });

      // Find the element slot (the other slot that's not the length slot)
      const elementSlot = Object.keys(trace[Arrays.address].writes).find((slot) => slot !== lengthSlot);

      // Check the element write
      expect(trace[Arrays.address].writes[elementSlot || ""][0]).toEqual({
        label: "dynamicArray[0]",
        current: 0n,
        next: value,
        type: "uint256",
      });
    });

    it("should trace dynamic array element slot access", async () => {
      const client = getClient();

      // First push two elements to have something to update
      await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.pushToDynamicArray(100n)),
      });

      await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.pushToDynamicArray(200n)),
      });

      // Now update the second element
      const updateIndex = 1;
      const newValue = 999n;

      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.updateDynamicArray(updateIndex, newValue)),
      });

      // We should only see a write to the element's slot, not to the length slot
      expect(Object.keys(trace[Arrays.address].writes).length).toBe(1);

      // Get the slot we're writing to
      const slot = Object.keys(trace[Arrays.address].writes)[0];

      // Verify the write
      expect(trace[Arrays.address].writes[slot][0]).toEqual({
        label: "dynamicArray[1]",
        current: 200n,
        next: newValue,
        type: "uint256",
      });
    });

    it("should trace struct array slot access with complex data", async () => {
      const client = getClient();
      const id = 42n;
      const name = "Test Item";

      // Add a struct to the items array
      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.addItem(id, name)),
      });

      // The array length should be updated
      const lengthSlot = getSlotHex(6); // fixedArray: 0-4, dynamicArray: 5, items: 6
      expect(trace[Arrays.address].writes).toHaveProperty(lengthSlot);

      // A struct with uint256, string, and bool will span multiple slots
      // We should see multiple storage writes:
      // 1. The array length update
      // 2. The id field (uint256)
      // 3. The name field (string - may use multiple slots)
      // 4. The active field (bool)
      expect(Object.keys(trace[Arrays.address].writes).length).toBeGreaterThan(2);

      // Verify length update
      expect(trace[Arrays.address].writes[lengthSlot][0]).toEqual({
        label: "items.length",
        current: 0n,
        next: 1n,
        type: "uint256",
      });

      // Now test updating just one field in the struct
      const toggleTrace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.toggleItemActive(0)),
      });

      // Find the slot with the active field - this should only update one slot
      expect(Object.keys(toggleTrace[Arrays.address].writes).length).toBe(1);

      const toggleSlot = Object.keys(toggleTrace[Arrays.address].writes)[0];
      expect(toggleTrace[Arrays.address].writes[toggleSlot][0]).toEqual({
        label: "items[0].active",
        current: true,
        next: false,
        type: "bool",
      });
    });

    it("should trace nested array slot access patterns", async () => {
      const client = getClient();

      // First create an outer array
      await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.addNestedArray()),
      });

      // Then push a value to the inner array
      const outerIndex = 0;
      const value = 777n;

      const trace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.pushToNestedArray(outerIndex, value)),
      });

      // We should see multiple storage slots accessed:
      // 1. Inner array length slot update
      // 2. Element slot write
      expect(Object.keys(trace[Arrays.address].writes).length).toBeGreaterThanOrEqual(2);

      // Verify one slot is a length update (0 to 1)
      const lengthSlot = Object.keys(trace[Arrays.address].writes).find(
        (slot) =>
          trace[Arrays.address].writes[slot][0].current === 0n && trace[Arrays.address].writes[slot][0].next === 1n,
      );

      expect(lengthSlot).toBeDefined();
      expect(trace[Arrays.address].writes[lengthSlot || ""][0]).toEqual({
        label: "nestedArrays[0].length",
        current: 0n,
        next: 1n,
        type: "uint256",
      });

      // Find the element write slot
      const elementSlot = Object.keys(trace[Arrays.address].writes).find((slot) => slot !== lengthSlot);

      expect(elementSlot).toBeDefined();
      expect(trace[Arrays.address].writes[elementSlot || ""][0]).toEqual({
        label: "nestedArrays[0][0]",
        current: 0n,
        next: value,
        type: "uint256",
      });

      // Now update an element in the nested array
      const innerIndex = 0;
      const newValue = 888n;

      const updateTrace = await traceStorageAccess({
        client,
        from: caller.toString(),
        to: Arrays.address,
        data: encodeFunctionData(Arrays.write.updateNestedArray(outerIndex, innerIndex, newValue)),
      });

      // We should only see the element slot being written to
      expect(Object.keys(updateTrace[Arrays.address].writes).length).toBe(1);

      const updateSlot = Object.keys(updateTrace[Arrays.address].writes)[0];
      expect(updateTrace[Arrays.address].writes[updateSlot][0]).toEqual({
        label: "nestedArrays[0][0]",
        current: value,
        next: newValue,
        type: "uint256",
      });
    });
  });
});
