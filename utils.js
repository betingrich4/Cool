import fetch from 'node-fetch';

export async function postToDashboard(userId, event, data = null) {
    try {
        await fetch(`http://localhost:${process.env.PORT || 3000}/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId,
                event,
                data
            })
        });
    } catch (error) {
        console.error('Failed to update dashboard:', error);
    }
}
