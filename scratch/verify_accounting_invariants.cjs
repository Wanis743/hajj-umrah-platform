const assert = require('assert');

// Mocking the Accounting System
class AccountingSystem {
    constructor() {
        this.journals = [];
        this.lockedPeriods = new Set();
    }

    lockPeriod(period) {
        this.lockedPeriods.add(period);
    }

    saveJournal(journal) {
        if (this.lockedPeriods.has(journal.period)) {
            throw new Error('Cannot save journal to a locked period');
        }

        const totalDebits = journal.entries
            .filter(e => e.type === 'debit')
            .reduce((sum, e) => sum + e.amount, 0);
            
        const totalCredits = journal.entries
            .filter(e => e.type === 'credit')
            .reduce((sum, e) => sum + e.amount, 0);

        if (totalDebits !== totalCredits) {
            throw new Error('Journal debits must equal credits');
        }

        this.journals.push(journal);
        return true;
    }
}

function runTests() {
    console.log('Running Accounting Invariants Tests...');
    const system = new AccountingSystem();

    // Test 1: Balanced Journal
    try {
        system.saveJournal({
            period: '2026-08',
            entries: [
                { type: 'debit', amount: 100 },
                { type: 'credit', amount: 100 }
            ]
        });
        console.log('✅ Passed: Balanced journal can be saved');
    } catch (e) {
        console.error('❌ Failed: Balanced journal should be saved', e);
    }

    // Test 2: Unbalanced Journal
    try {
        system.saveJournal({
            period: '2026-08',
            entries: [
                { type: 'debit', amount: 100 },
                { type: 'credit', amount: 90 }
            ]
        });
        console.error('❌ Failed: Unbalanced journal should throw an error');
    } catch (e) {
        assert.strictEqual(e.message, 'Journal debits must equal credits');
        console.log('✅ Passed: Unbalanced journal cannot be saved');
    }

    // Test 3: Locked Period
    try {
        system.lockPeriod('2026-07');
        system.saveJournal({
            period: '2026-07',
            entries: [
                { type: 'debit', amount: 50 },
                { type: 'credit', amount: 50 }
            ]
        });
        console.error('❌ Failed: Journal in locked period should throw an error');
    } catch (e) {
        assert.strictEqual(e.message, 'Cannot save journal to a locked period');
        console.log('✅ Passed: Cannot save to locked periods');
    }
}

runTests();
