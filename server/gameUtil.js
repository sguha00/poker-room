const Deck = require('../client/deck/deck.js');
const Ranker = require('handranker');

const gameDeck = new Deck();
const gameState = {
	players: [],
	gameDeck,
	action: false,
	board: [],
	pot: 0,
	bigBlindValue: 10,
	smallBlindValue: 5,
	activeBet: 0,
	messages: []
};

const addPlayer = (socketId) => {
	gameState.players.push({
		id: socketId,
		name: '',
		bankroll: 1000,
		cards: [],
		action: false,
		button: false,
		smallBlind: false,
		bigBlind: false,
		active: false,
		activeBet: 0
	});
};

const dealPlayers = () => {
	gameState.board = [];
	gameState.gameDeck.shuffleDeck();
	for (let i = 0; i < gameState.players.length; i++) {
		gameState.players[i].cards = gameState.gameDeck.dealCards(2);
	}
	gameState.action = 'preflop';
};

const blindsToPot = () => {
	// clear pot
	gameState.pot = 0;
	gameState.players.forEach((player) => {
		if (player.smallBlind) {
			player.bankroll -= gameState.smallBlindValue;
			player.activeBet = gameState.smallBlindValue;
			gameState.pot += gameState.smallBlindValue;
		} else if (player.bigBlind) {
			player.bankroll -= gameState.bigBlindValue;
			player.activeBet = gameState.bigBlindValue;
			gameState.pot += gameState.bigBlindValue;
		}
	});

	// set initial bet to join in as BB value
	gameState.activeBet = gameState.bigBlindValue;
};

const setInitialBlinds = () => {
	gameState.players[0].button = true;
	gameState.players[0].smallBlind = true;
	gameState.players[1].bigBlind = true;
	gameState.players[0].active = true;
	blindsToPot();
};

const moveBlinds = () => {
	for (let i = 0; i < gameState.players.length; i++) {
		if (gameState.players[i].button === true) {
			// reset active player to match blinds
			gameState.players.forEach((player) => {
				player.active = false;
			});

			// set current button to false and switch to BB
			gameState.players[i].button = false;
			gameState.players[i].smallBlind = false;
			gameState.players[i].bigBlind = true;

			// edge case if BB is last in the array
			if (i + 1 < gameState.players.length) {
				gameState.players[i + 1].button = true;
				gameState.players[i + 1].active = true;
				gameState.players[i + 1].smallBlind = true;
				gameState.players[i + 1].bigBlind = false;
			} else {
				gameState.players[0].button = true;
				gameState.players[0].active = true;
				gameState.players[0].smallBlind = true;
				gameState.players[0].bigBlind = false;
			}
			blindsToPot();
			break;
		}
	}
};

const check = (socketId) => {
	for (let i = 0; i < gameState.players.length; i++) {
		if (gameState.players[i].id === socketId) {
			gameState.players[i].action = true;
			// const lastActivePlayer =
			// 	gameState.players.map((player) => player.action).filter((action) => action === false).length < 1;

			// edge case for preflop player order, BB needs to switch to first to act after preflop
			// if (!(lastActivePlayer && gameState.action === 'preflop')) {
			if (i + 1 < gameState.players.length) {
				gameState.players[i + 1].active = true;
				gameState.players[i].active = false;
			} else {
				gameState.players[0].active = true;
				gameState.players[i].active = false;
			}
			// }
		}
	}
};

const playerActionCheck = () => {
	for (let i = 0; i < gameState.players.length; i++) {
		if (gameState.players[i].action === false) {
			return false;
		}
	}
	return true;
};

const resetPlayerAction = () => {
	gameState.players.forEach((player) => {
		player.action = false;
		player.activeBet = 0;
	});

	// reset active bet as well
	gameState.activeBet = 0;
};

const potToPlayer = (player) => {
	player.bankroll += gameState.pot;
	gameState.pot = 0;
};

const potToTie = () => {
	const halfPot = gameState.pot / 2;
	gameState.players.forEach((player) => {
		player.bankroll += halfPot;
	});
	gameState.pot = 0;
};

const determineWinner = () => {
	const hands = gameState.players;
	const board = gameState.board;
	console.log('hands', hands);
	console.log('board', board);
	const results = Ranker.orderHands(hands, board);
	console.log('results', results);
	// check for tie
	if (results[0].length > 1) {
		potToTie();
	} else {
		const winnerId = results[0][0].id;
		console.log('winnerId', winnerId);
		const winner = gameState.players.filter((player) => player.id === winnerId)[0];
		console.log('winner', winner);
		potToPlayer(winner);
	}
};

const resetActive = () => {
	gameState.players.forEach((player) => {
		if (player.bigBlind) {
			player.active = true;
		} else if (player.button) {
			player.active = false;
		}
	});
};

const changeBoard = () => {
	if (gameState.action === 'preflop') {
		gameState.action = 'flop';
		resetActive();
		resetPlayerAction();
		gameState.gameDeck.dealCards(3).forEach((card) => gameState.board.push(card));
	} else if (gameState.action === 'flop') {
		gameState.action = 'turn';
		resetActive();
		resetPlayerAction();
		gameState.gameDeck.dealCards(1).forEach((card) => gameState.board.push(card));
	} else if (gameState.action === 'turn') {
		gameState.action = 'river';
		resetActive();
		resetPlayerAction();
		gameState.gameDeck.dealCards(1).forEach((card) => gameState.board.push(card));
	} else if (gameState.action === 'river') {
		determineWinner();
		dealPlayers();
		resetPlayerAction();
		moveBlinds();
	}
};

const removePlayer = (socketId) => {
	gameState.players = gameState.players.filter((player) => player.id !== socketId);

	// give pot to remaining player
	gameState.players.forEach(player => potToPlayer(player))
};

const fold = (socketId) => {
	const winner = gameState.players.filter((player) => player.id !== socketId)[0];
	potToPlayer(winner);
	dealPlayers();
	resetPlayerAction();
	moveBlinds();
};

const call = (socketId) => {
	const callingPlayer = gameState.players.filter((player) => player.id === socketId)[0];
	const callAmount = gameState.activeBet - callingPlayer.activeBet;

	// add to pot call amount
	gameState.pot += callAmount;
	callingPlayer.activeBet += callAmount;

	// subtract from player stack
	callingPlayer.bankroll -= callAmount;

	// use check function to move to next player
	check(socketId);
};

const bet = (socketId) => {
	const bettingPlayer = gameState.players.filter((player) => player.id === socketId)[0];

	// currently static for now
	const betAmount = 100;

	// add to pot bet amount
	gameState.pot += betAmount;
	bettingPlayer.activeBet += betAmount;

	// adjust game active bet
	gameState.activeBet = betAmount;

	//subtract from player stack
	bettingPlayer.bankroll -= betAmount;

	// reset action
	gameState.players.forEach((player) => {
		player.action = false;
	});

	// use check function to move to next player
	check(socketId);
};

const raise = (socketId) => {
	const raisingPlayer = gameState.players.filter((player) => player.id === socketId)[0];

	// currently static for now
	const raiseAmount = gameState.activeBet + 100;

	// add to pot bet amount
	gameState.pot += raiseAmount - raisingPlayer.activeBet;

	//subtract from player stack
	raisingPlayer.bankroll -= raiseAmount - raisingPlayer.activeBet;

	raisingPlayer.activeBet = raiseAmount;

	// adjust game active bet
	gameState.activeBet = raiseAmount;

	// reset action
	gameState.players.forEach((player) => {
		player.action = false;
	});

	// use check function to move to next player
	check(socketId);
};

const addMessage = (message, socketId) => {
	const name = gameState.players.filter((player) => player.id === socketId)[0].name
	gameState.messages.push({text: message, author: name})
}

const addName = (name, socketId) => {
	const changePlayer = gameState.players.filter((player) => player.id === socketId)[0];
	changePlayer.name = name
}

module.exports = {
	gameState,
	addPlayer,
	dealPlayers,
	setInitialBlinds,
	moveBlinds,
	check,
	playerActionCheck,
	changeBoard,
	removePlayer,
	fold,
	determineWinner,
	call,
	bet,
	raise,
	addMessage,
	addName
};
