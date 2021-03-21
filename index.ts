import { Client, EmbedFieldData, Message, MessageEmbed } from 'discord.js';
import AWS from 'aws-sdk';

// Use .env variables
import * as dotenv from 'dotenv';
dotenv.config();

AWS.config.update({
	region: process.env.AWS_DEFAULT_REGION,
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Clients initialization
const client = new Client();
const dbClient = new AWS.DynamoDB.DocumentClient();

type Payload = {
	user_id: string;
	message: string;
	log_date: string;
};

type DDBPutParams = {
	TableName: string;
	Item: Payload;
	ConditionExpression: string;
	ExpressionAttributeValues: Object;
};

type DDBQueryParams = {
	TableName: string;
	ExpressionAttributeValues: object;
	KeyConditionExpression: string;
};

// Register an event so that when the bot is ready, it will log a messsage to the terminal
client.on('ready', () => {
	console.log(`Logged in as ${client.user?.tag}!`);
});

// Register an event to handle incoming messages
client.on('message', async (msg: Message) => {
	// Handling daily logging messages
	if (msg.content.startsWith('$logday')) {
		// If the bot is the message author, disregard
		let filter = (msg: Message) => !msg.author.bot;

		// Accept only one answer in the next 15 seconds
		let options = {
			max: 1,
			time: 30000,
		};

		// Create message collector to accept incoming chat messages
		const collector = msg.channel.createMessageCollector(filter, options);

		// Instantiate empty payload to be filled on collection
		let payload = {} as Payload;

		// Check if the message starts with '!hello' and respond with 'world!' if it does.
		msg.reply('What do you want to log for today?');

		collector.on('collect', (message) => {
			const timestamp = new Date(message.createdAt);
			payload = {
				user_id: message.author.id,
				message: message.content,
				log_date: timestamp.toLocaleDateString('en-US'),
			};
		});

		// When the collector is done, POST the the payload if the user_id/date combination is not already in DDB
		collector.on('end', (_) => {
			const params: DDBPutParams = {
				TableName: process.env.DYNAMODB_TABLE_NAME as string,
				Item: payload,
				ConditionExpression: 'log_date <> :timestampVal',
				ExpressionAttributeValues: {
					':timestampVal': payload.log_date,
				},
			};

			dbClient.put(params, (error) => {
				if (!error) {
					msg.reply(
						`Success! Your log for ${payload.log_date} has been saved!`
					);
				} else {
					if (error.code === 'ConditionalCheckFailedException') {
						msg.reply(
							"You already logged your progress today. You can't log more than once per day!"
						);
					} else {
						msg.reply('Something went wrong, please try again!');
					}
				}
			});
		});
	}

	if (msg.content.startsWith('$getlogs')) {
		// DDB query parameters to check for all the logs from the current user

		// $getlogs only accepts 1 additional argument, the number of logs to show
		const command = msg.content.split(' ').slice(1);

		// defaults to 10 if not provided
		let numberOfLogs = 10;

		// Checking if we have exactly one argument
		if (command.length == 1) {
			numberOfLogs = Number(command[0]);
			if (isNaN(numberOfLogs)) {
				msg.reply('Please input a number');
				return;
			}
		}
		// Replying with an error message and preventing a DDB query to be executed
		else if (command.length > 1) {
			msg.reply('I received more arguments that I can handle!');
			return;
		}

		if (numberOfLogs < 0) {
			msg.reply(
				'Please, enter either a positive number or 0 if you want to look at all your logs!'
			);
			return;
		}

		// Query parameters for the DynamoDB put call
		var params: DDBQueryParams = {
			TableName: process.env.DYNAMODB_TABLE_NAME as string,
			ExpressionAttributeValues: {
				':user_id': msg.author.id,
			},
			KeyConditionExpression: 'user_id = :user_id',
		};

		// Initialize empty user body
		let logHistory: EmbedFieldData[] = [];

		// Initialize empty date array for streak calculations
		let logDates: string[] = [];

		dbClient.query(params, function (err, data) {
			// Reply something on error but logs the error.
			if (err) {
				console.log(err);
				msg.reply('Something went wrong, sorry about that!');
				return;
			} else {
				// When the query returns no items (user has not logged anything yet)
				if (data.Items?.length === 0) {
					msg.reply(
						"You don't have any logged message! Start today by typing `$logday`!"
					);
					return;
				} else {
					// Iterate over the returned objects, creating of log objects and an array of ordered dates
					data.Items?.forEach(function (element, index) {
						let logBody = {
							name: `Day ${index + 1}   |   ${element.log_date}`,
							value: String(element.message),
							inline: false,
						};
						logHistory = [...logHistory, logBody];
						logDates = [...logDates, element.log_date];
					});

					// Actual logs to be showed.
					// We still need to query the others to calculate the log streak
					const newLog = logHistory.slice(
						Math.max(
							logHistory.length -
								Math.min(logHistory.length, numberOfLogs),
							0
						)
					);

					// Gets the current streak of consecutive days with a log
					const currentStreak = (arr: string[]): number => {
						// Streak counter
						let count = 0;
						const UNIX_DAY = 86400000;

						// We reverse the date array and check for each date if there's exactly a difference of 1 day * the current element's index
						// First day would be (1 day) * 0, same day
						// Second day would be (1 day) * 1, yesterday
						// And so on until we don't have a match, at which point we know we don't have a streak anymore and we can just return the count
						arr.reverse().forEach((date, i) => {
							if (
								new Date().setUTCHours(0, 0, 0, 0) -
									new Date(date).setUTCHours(0, 0, 0, 0) ===
								i * UNIX_DAY
							)
								count += 1;
						});
						return count;
					};

					// Creating the body of the embedded log history message
					const msgReply = new MessageEmbed()
						.setColor('#0099ff')
						.setThumbnail(msg.author.avatarURL() as string)
						.setTitle(`${msg.author.username} log report`)
						.setDescription(
							`Showing ${Math.min(
								numberOfLogs,
								logHistory.length
							)} out of ${logHistory.length} logged days`
						)
						.addFields(
							...newLog,
							{
								name: 'Days completed',
								value: logHistory.length,
								inline: true,
							},
							{
								name: 'Current Streak',
								value: currentStreak(logDates),
								inline: true,
							}
						)
						.setTimestamp()
						.setFooter('Add a new log with `$logday`');

					msg.reply(msgReply);
					return;
				}
			}
		});
	}
});

// client.login logs the bot in and sets it up for use. You'll enter your token here.
client.login(process.env.DISCORD_TOKEN);
