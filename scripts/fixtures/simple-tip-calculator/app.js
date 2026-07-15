const billInput = document.querySelector("#bill-input");
const partySizeInput = document.querySelector("#party-size-input");
const tipOutput = document.querySelector("#tip-per-person");
const totalOutput = document.querySelector("#total-per-person");
let tipRate = 0;

function updateTotals() {
  const bill = Math.max(0, Number(billInput.value) || 0);
  const partySize = Math.max(1, Number(partySizeInput.value) || 1);
  const tipPerPerson = (bill * tipRate) / partySize;
  tipOutput.textContent = `$${tipPerPerson.toFixed(2)}`;
  totalOutput.textContent = `$${((bill + bill * tipRate) / partySize).toFixed(2)}`;
}

document.querySelectorAll("[data-tip]").forEach((button) => {
  button.addEventListener("click", () => {
    tipRate = Number(button.dataset.tip) / 100;
    updateTotals();
  });
});
billInput.addEventListener("input", updateTotals);
partySizeInput.addEventListener("input", updateTotals);
