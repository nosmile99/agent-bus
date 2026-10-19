package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TriStateCheckbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.ui.components.Section

@Composable
fun SelectionScreen() {
    var checked by rememberSaveable { mutableStateOf(true) }
    var switched by rememberSaveable { mutableStateOf(false) }
    var slider by remember { mutableFloatStateOf(0.5f) }
    var range by remember { mutableStateOf(0.2f..0.8f) }
    val radioOptions = listOf("Nyx", "Ryuki", "nosmile99")
    var selectedRadio by rememberSaveable { mutableStateOf(radioOptions[0]) }
    val childStates = remember { List(3) { mutableStateOf(it == 0) } }
    val parentState = when {
        childStates.all { it.value } -> ToggleableState.On
        childStates.none { it.value } -> ToggleableState.Off
        else -> ToggleableState.Indeterminate
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Section("Checkbox") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = checked, onCheckedChange = { checked = it })
                Text("Single checkbox", modifier = Modifier.padding(start = 8.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TriStateCheckbox(
                    state = parentState,
                    onClick = {
                        val next = parentState != ToggleableState.On
                        childStates.forEach { it.value = next }
                    },
                )
                Text("Parent (tri-state)", modifier = Modifier.padding(start = 8.dp))
            }
            childStates.forEachIndexed { index, state ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 24.dp)) {
                    Checkbox(checked = state.value, onCheckedChange = { state.value = it })
                    Text("Child ${index + 1}", modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
        Section("Radio buttons") {
            Column(Modifier.selectableGroup()) {
                radioOptions.forEach { option ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = option == selectedRadio,
                                onClick = { selectedRadio = option },
                                role = Role.RadioButton,
                            )
                            .padding(vertical = 4.dp),
                    ) {
                        RadioButton(selected = option == selectedRadio, onClick = null)
                        Text(option, modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
            Text("Selected: $selectedRadio", style = MaterialTheme.typography.bodySmall)
        }
        Section("Switch") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Notifications")
                Switch(checked = switched, onCheckedChange = { switched = it })
            }
        }
        Section("Sliders") {
            Text("Volume: ${(slider * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
            Slider(value = slider, onValueChange = { slider = it }, modifier = Modifier.fillMaxWidth())
            Text(
                "Range: ${(range.start * 100).toInt()}–${(range.endInclusive * 100).toInt()}%",
                style = MaterialTheme.typography.bodySmall,
            )
            RangeSlider(value = range, onValueChange = { range = it }, modifier = Modifier.fillMaxWidth())
        }
    }
}
